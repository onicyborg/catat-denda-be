import { Module, Controller, Get } from '@nestjs/common';
import { FinesModule } from './fines/module.js';
import { MasterModule } from './master/master.module.js';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuditWriter } from './audit.js';
import { SessionGuard, Public } from './auth/auth.js';
import { AuthController } from './auth/controller.js';
@Controller('health')
class HealthController {
  constructor(private db: PrismaService) {}
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    MasterModule,
    FinesModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
  ],
  controllers: [AuthController, HealthController],
  providers: [
    AuditWriter,
    SessionGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: SessionGuard },
  ],
})
export class AppModule {}
