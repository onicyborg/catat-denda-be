import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCookieAuth,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionGuard, Public, hash, type AuthRequest } from './auth.js';
import { AuditWriter } from '../audit.js';
import { LoginDto, PasswordDto } from './dto.js';
const dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id });
const authEnvelope = {
  type: 'object' as const,
  required: ['data'],
  properties: {
    data: {
      type: 'object' as const,
      required: ['id', 'email', 'csrfToken'],
      properties: {
        id: { type: 'string' as const },
        email: { type: 'string' as const },
        role: { type: 'string' as const },
        csrfToken: { type: 'string' as const },
      },
    },
  },
};
@ApiTags('auth')
@ApiCookieAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private db: PrismaService,
    private config: ConfigService,
    private guard: SessionGuard,
    private audit: AuditWriter,
  ) {}
  private cookie() {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      path: '/api/v1',
    };
  }
  @ApiCreatedResponse({ schema: authEnvelope })
  @Public()
  @ApiOperation({ security: [] })
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(
    @Body() body: LoginDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.db.user.findUnique({
      where: { email: body.email.trim().toLowerCase() },
    });
    // Always perform password verification to avoid revealing whether an email exists.
    const encoded = user?.passwordHash ?? (await dummyHash);
    const valid = await argon2.verify(encoded, body.password);
    if (!user || !user.isActive || !valid)
      throw new UnauthorizedException('Email atau kata sandi tidak sesuai.');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() +
        this.config.getOrThrow<number>('SESSION_TTL_HOURS') * 3600000,
    );
    const session = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      if (!current.isActive || current.passwordHash !== user.passwordHash)
        throw new UnauthorizedException('Kredensial berubah. Silakan ulangi.');
      const created = await tx.authSession.create({
        data: { userId: user.id, tokenHash: hash(token), expiresAt },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await this.audit.write(tx, {
        actorUserId: user.id,
        action: 'LOGIN',
        entityType: 'AuthSession',
        entityId: created.id,
        requestId: req.requestId,
      });
      return created;
    });
    res.cookie('efms_session', token, { ...this.cookie(), expires: expiresAt });
    return {
      id: user.id,
      email: user.email,
      csrfToken: this.guard.csrf(session.id),
    };
  }
  @ApiOkResponse({ schema: authEnvelope })
  @Get('me')
  async me(@Req() req: AuthRequest) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: req.session!.userId },
      select: { id: true, email: true, role: true },
    });
    return { ...user, csrfToken: this.guard.csrf(req.session!.id) };
  }
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['success'],
          properties: { success: { type: 'boolean' } },
        },
      },
    },
  })
  @Post('logout')
  async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.session!.userId}::uuid FOR UPDATE`;
      await tx.authSession.update({
        where: { id: req.session!.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.write(tx, {
        actorUserId: req.session!.userId,
        action: 'LOGOUT',
        entityType: 'AuthSession',
        entityId: req.session!.id,
        requestId: req.requestId,
      });
    });
    res.clearCookie('efms_session', this.cookie());
    return { success: true };
  }
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiResponse({ status: 401, description: 'Sesi tidak berlaku.' })
  @ApiResponse({
    status: 422,
    description: 'Isian tidak valid atau kata sandi lama salah.',
  })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['success'],
          properties: { success: { type: 'boolean' } },
        },
      },
    },
  })
  @Post('change-password')
  async password(@Body() body: PasswordDto, @Req() req: AuthRequest) {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: req.session!.userId },
    });
    if (!(await argon2.verify(user.passwordHash, body.currentPassword)))
      throw new UnprocessableEntityException('Kata sandi lama tidak sesuai.');
    const passwordHash = await argon2.hash(body.newPassword, {
      type: argon2.argon2id,
    });
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      const session = await tx.authSession.findUnique({
        where: { id: req.session!.id },
        include: { user: true },
      });
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !session.user.isActive
      ) {
        throw new UnauthorizedException('Sesi berakhir.');
      }
      const result = await tx.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: { passwordHash },
      });
      if (!result.count)
        throw new UnauthorizedException('Sesi berubah, silakan ulangi.');
      await tx.authSession.updateMany({
        where: {
          userId: user.id,
          id: { not: req.session!.id },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await this.audit.write(tx, {
        actorUserId: user.id,
        action: 'PASSWORD_CHANGE',
        entityType: 'User',
        entityId: user.id,
        requestId: req.requestId,
      });
    });
    return { success: true };
  }
}
