import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
export type Actor = { userId: string; requestId?: string };
@Injectable()
export class MasterRepository {
  constructor(readonly db: PrismaService) {}
  async write<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { identity?: boolean; violationId?: string } = {},
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        // One namespace spans aliases and primary names. The DB lock also covers different API processes.
        if (options.identity)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(72821, 1)`;
        if (options.violationId)
          await this.db.lockRow(tx, 'ViolationType', options.violationId);
        return work(tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictException(
            'Kode atau alias sudah digunakan. Gunakan nilai lain.',
          );
        if (error.code === 'P2025')
          throw new NotFoundException('Data tidak ditemukan.');
      }
      throw error;
    }
  }
  audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    before?: Prisma.InputJsonValue,
    after?: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        requestId: actor.requestId,
        action,
        entityType,
        entityId,
        beforeJson: before,
        afterJson: after,
      },
    });
  }
}
