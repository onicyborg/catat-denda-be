import {
  Injectable,
  SetMetadata,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
export const Public = () => SetMetadata('publicRoute', true);
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export type AuthRequest = Request & {
  session?: { id: string; userId: string };
  requestId?: string;
};
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private db: PrismaService,
    private config: ConfigService,
    private reflector: Reflector,
  ) {}
  csrf(id: string) {
    return createHmac(
      'sha256',
      this.config.getOrThrow<string>('SESSION_SECRET'),
    )
      .update(id)
      .digest('hex');
  }
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (
        req.headers.origin !==
        new URL(this.config.getOrThrow<string>('APP_BASE_URL')).origin
      )
        throw new ForbiddenException('Asal permintaan tidak diizinkan.');
    }
    if (
      this.reflector.getAllAndOverride<boolean>('publicRoute', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const token: unknown = req.cookies?.efms_session;
    if (typeof token !== 'string')
      throw new UnauthorizedException('Silakan masuk kembali.');
    const session = await this.db.authSession.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    )
      throw new UnauthorizedException('Sesi berakhir.');
    if (session.user.role !== 'ADMIN') throw new ForbiddenException();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const supplied = req.headers['x-csrf-token'];
      const expected = this.csrf(session.id);
      if (
        typeof supplied !== 'string' ||
        !/^[a-f0-9]{64}$/.test(supplied) ||
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        throw new ForbiddenException('Token keamanan tidak valid.');
    }
    await this.db.authSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    req.session = { id: session.id, userId: session.userId };
    return true;
  }
}
