import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Actor } from '../master/repository.js';
import { SettingsDto } from './dto.js';
const fallback = {
  businessName: 'Catat Denda',
  currency: 'IDR',
  timezone: 'Asia/Jakarta',
  finePolicyReference: null,
  version: 0,
  updatedAt: null,
  updatedBy: null,
};
@Injectable()
export class SettingsService {
  constructor(private db: PrismaService) {}
  async read(tx: Prisma.TransactionClient = this.db) {
    const row = await tx.appSettings.findUnique({ where: { id: 1 } });
    return row
      ? {
          businessName: row.businessName,
          currency: row.currency,
          timezone: row.timezone,
          finePolicyReference: row.finePolicyReference,
          version: row.version,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
        }
      : fallback;
  }
  audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    before: Prisma.InputJsonValue,
    after: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        requestId: actor.requestId,
        action: 'SETTINGS_UPDATE',
        entityType: 'AppSettings',
        entityId: '00000000-0000-4000-8000-000000000001',
        beforeJson: before,
        afterJson: after,
      },
    });
  }
  async update(body: SettingsDto, actor: Actor) {
    if (
      body.businessName === undefined &&
      body.finePolicyReference === undefined
    ) {
      throw new UnprocessableEntityException(
        'Isi perubahan nama usaha atau referensi kebijakan.',
      );
    }
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72824,1)`;
      const before = await this.read(tx);
      if (before.version !== body.version)
        throw new ConflictException(
          'Pengaturan sudah berubah. Muat ulang sebelum menyimpan.',
        );
      const data = {
        businessName: body.businessName ?? before.businessName,
        finePolicyReference:
          body.finePolicyReference === undefined
            ? before.finePolicyReference
            : body.finePolicyReference || null,
        updatedBy: actor.userId,
      };
      await tx.appSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data, version: 1 },
        update: { ...data, version: { increment: 1 } },
      });
      const after = await this.read(tx);
      const snapshot = (value: typeof before) => ({
        businessName: value.businessName,
        finePolicyReference: value.finePolicyReference,
        currency: value.currency,
        timezone: value.timezone,
        version: value.version,
      });
      await this.audit(tx, actor, snapshot(before), snapshot(after));
      return after;
    });
  }
}
