import { Injectable } from '@nestjs/common';
import type { Prisma } from './generated/prisma/client.js';
@Injectable()
export class AuditWriter {
  write(
    tx: Prisma.TransactionClient,
    input: {
      actorUserId: string;
      action: string;
      entityType: string;
      entityId: string;
      requestId?: string;
    },
  ) {
    // Deliberately accepts metadata only. Secrets cannot enter before/after payloads implicitly.
    return tx.auditLog.create({ data: input });
  }
}
