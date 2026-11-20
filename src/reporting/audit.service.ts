import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PageResult } from '../pagination.js';
import { AuditQuery } from './dto.js';
import { period } from './period.js';
const allowed = new Set([
  'id',
  'caseId',
  'memberId',
  'fineCaseMemberId',
  'caseNumber',
  'status',
  'version',
  'occurredAt',
  'violationTypeId',
  'violationCodeSnapshot',
  'violationNameSnapshot',
  'violationCategorySnapshot',
  'defaultRateSnapshot',
  'description',
  'sourceText',
  'postedBy',
  'postedAt',
  'voidedBy',
  'voidedAt',
  'voidReason',
  'members',
  'employeeId',
  'employeeNameSnapshot',
  'rawEmployeeName',
  'assignedAmount',
  'displayName',
  'employeeCode',
  'isActive',
  'aliases',
  'aliasDisplay',
  'aliasNormalized',
  'employeeId',
  'code',
  'name',
  'category',
  'defaultAmountPerPerson',
  'kind',
  'amount',
  'method',
  'effectiveAt',
  'originalPaymentId',
  'note',
  'netPaidAmount',
  'businessName',
  'finePolicyReference',
  'currency',
  'timezone',
  'filters',
  'rowCount',
  'format',
  'from',
  'to',
  'includeUndated',
]);
export function safePayload(
  value: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  let budget = 16000;
  const visit = (input: Prisma.JsonValue, depth: number): Prisma.JsonValue => {
    if (depth > 5 || budget <= 0) return '[Tampilan dipotong]';
    if (typeof input === 'string') {
      const text = input.slice(0, Math.min(2000, budget));
      budget -= text.length;
      return text.length < input.length ? text + ' [dipotong]' : text;
    }
    if (Array.isArray(input))
      return input.slice(0, 50).map((v) => visit(v, depth + 1));
    if (input && typeof input === 'object') {
      const out: Prisma.JsonObject = {};
      for (const [key, v] of Object.entries(input)) {
        if (
          !allowed.has(key) ||
          /password|token|cookie|secret|hash|authorization/i.test(key) ||
          v === undefined
        )
          continue;
        budget -= key.length;
        out[key] = visit(v, depth + 1);
      }
      return out;
    }
    return input;
  };
  return value === null ? null : visit(value, 0);
}
@Injectable()
export class AuditReadService {
  constructor(private db: PrismaService) {}
  async list(q: AuditQuery) {
    const p = period(q);
    return this.db.$transaction(
      async (tx) => {
        const where = {
          actorUserId: q.actorUserId,
          action: q.action,
          entityType: q.entityType,
          createdAt: { gte: p.start, lt: p.end },
        };
        const total = await tx.auditLog.count({ where }),
          rows = await tx.auditLog.findMany({
            where,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (q.page - 1) * q.limit,
            take: q.limit,
          });
        const users = await tx.user.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.actorUserId))] } },
          select: { id: true, username: true, email: true },
        });
        const names = new Map(
          users.map((u) => [u.id, u.username ?? u.email ?? u.id]),
        );
        return new PageResult(
          rows.map((r) => ({
            id: r.id,
            actorUserId: r.actorUserId,
            actorName: names.get(r.actorUserId) ?? r.actorUserId,
            action: r.action,
            entityType: r.entityType,
            entityId: r.entityId,
            createdAt: r.createdAt,
            requestId: r.requestId,
            beforeJson: safePayload(r.beforeJson),
            afterJson: safePayload(r.afterJson),
          })),
          {
            page: q.page,
            limit: q.limit,
            total,
            totalPages: Math.ceil(total / q.limit),
          },
        );
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  options() {
    return this.db.$transaction(
      async (tx) => {
        const actors = await tx.user.findMany({
          select: { id: true, username: true, email: true },
          orderBy: { createdAt: 'asc' },
        });
        const actions = await tx.auditLog.findMany({
          select: { action: true },
          distinct: ['action'],
          orderBy: { action: 'asc' },
        });
        const entities = await tx.auditLog.findMany({
          select: { entityType: true },
          distinct: ['entityType'],
          orderBy: { entityType: 'asc' },
        });
        return {
          actors: actors.map((a) => ({
            id: a.id,
            name: a.username ?? a.email ?? a.id,
          })),
          actions: actions.map((a) => a.action),
          entityTypes: entities.map((e) => e.entityType),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
