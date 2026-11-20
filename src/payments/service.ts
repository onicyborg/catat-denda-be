import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { Prisma, type PaymentEntry } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PageResult } from '../pagination.js';
import { ledgerTotal } from '../fines/calculations.js';
import type { Actor } from '../master/repository.js';
import { PaymentDto, PaymentQuery, ReverseDto } from './dto.js';
const include = {
  member: { include: { fineCase: true } },
  reversal: { select: { id: true } },
} satisfies Prisma.PaymentEntryInclude;
type Entry = Prisma.PaymentEntryGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
const invalid = (message: string) => {
  throw new UnprocessableEntityException(message);
};
export function retryable(error: unknown): boolean {
  const codes = new Set(['P2034', 'P2028', '40001', '40P01', '55P03']);
  const inspect = (value: unknown, depth: number): boolean => {
    if (!value || typeof value !== 'object' || depth > 5) return false;
    const e = value as Record<string, unknown>;
    return (
      ['code', 'originalCode', 'sqlState'].some(
        (k) => typeof e[k] === 'string' && codes.has(e[k] as string),
      ) ||
      ['meta', 'cause', 'driverAdapterError'].some((k) =>
        inspect(e[k], depth + 1),
      )
    );
  };
  return inspect(error, 0);
}
@Injectable()
export class PaymentsService {
  constructor(readonly db: PrismaService) {}
  async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
            return work(tx);
          },
          { timeout: 10000, maxWait: 5000 },
        );
      } catch (error) {
        if (!retryable(error)) throw error;
      }
    }
    throw new ConflictException({
      message: 'Transaksi sedang sibuk. Silakan ulangi permintaan yang sama.',
      retryable: true,
    });
  }
  audit(
    tx: Tx,
    actor: Actor,
    entry: PaymentEntry,
    caseId: string,
    before: bigint,
    after: bigint,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        requestId: actor.requestId,
        action: entry.kind === 'PAYMENT' ? 'PAYMENT_CREATE' : 'PAYMENT_REVERSE',
        entityType: 'PaymentEntry',
        entityId: entry.id,
        beforeJson: { netPaidAmount: before.toString() },
        afterJson: {
          caseId,
          memberId: entry.fineCaseMemberId,
          kind: entry.kind,
          amount: entry.amount,
          method: entry.method,
          effectiveAt: entry.effectiveAt.toISOString(),
          originalPaymentId: entry.originalPaymentId,
          note: entry.note,
          netPaidAmount: after.toString(),
        },
      },
    });
  }
  async serialized(tx: Tx, entries: Entry[]) {
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.recordedBy))] } },
      select: { id: true, username: true, email: true },
    });
    const names = new Map(
      users.map((u) => [
        u.id,
        u.username ?? u.email ?? `Admin ${u.id.slice(0, 8)}`,
      ]),
    );
    return entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      amount: e.amount,
      signedAmount: (e.kind === 'PAYMENT'
        ? BigInt(e.amount)
        : -BigInt(e.amount)
      ).toString(),
      method: e.method,
      note: e.note,
      effectiveAt: e.effectiveAt,
      createdAt: e.createdAt,
      recordedBy: e.recordedBy,
      recordedByName: names.get(e.recordedBy) ?? e.recordedBy,
      originalPaymentId: e.originalPaymentId,
      reversalId: e.reversal?.id ?? null,
      canReverse:
        e.kind === 'PAYMENT' &&
        !e.reversal &&
        e.member.fineCase.status === 'POSTED',
      caseId: e.member.fineCaseId,
      caseCode: `DND-${String(e.member.fineCase.caseNumber).padStart(6, '0')}`,
      caseStatus: e.member.fineCase.status,
      memberId: e.fineCaseMemberId,
      employeeId: e.member.employeeId,
      employeeName:
        e.member.employeeNameSnapshot ??
        e.member.rawEmployeeName ??
        'Peserta belum ditentukan',
    }));
  }
  async find(tx: Tx, id: string) {
    const e = await tx.paymentEntry.findUnique({ where: { id }, include });
    if (!e) throw new NotFoundException('Entri pembayaran tidak ditemukan.');
    return e;
  }
  async get(id: string) {
    return this.db.$transaction(
      async (tx) => (await this.serialized(tx, [await this.find(tx, id)]))[0],
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async list(q: PaymentQuery) {
    if (q.from && q.to && q.from > q.to)
      invalid('Tanggal awal harus sebelum tanggal akhir.');
    const where: Prisma.PaymentEntryWhereInput = {
      kind: q.kind,
      member:
        q.employeeId || q.caseId
          ? { employeeId: q.employeeId, fineCaseId: q.caseId }
          : undefined,
      effectiveAt:
        q.from || q.to
          ? {
              gte: q.from ? new Date(`${q.from}T00:00:00+07:00`) : undefined,
              lt: q.to
                ? new Date(
                    new Date(`${q.to}T00:00:00+07:00`).getTime() + 86400000,
                  )
                : undefined,
            }
          : undefined,
    };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.paymentEntry.count({ where });
        const entries = await tx.paymentEntry.findMany({
          where,
          include,
          orderBy: [
            { effectiveAt: 'desc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        });
        return new PageResult(await this.serialized(tx, entries), {
          page: q.page,
          limit: q.limit,
          total,
          totalPages: Math.ceil(total / q.limit),
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async mutate(
    key: string,
    operation: string,
    target: string,
    payload: Prisma.InputJsonValue,
    actor: Actor,
    work: (tx: Tx, key: string, requestHash: string) => Promise<PaymentEntry>,
  ) {
    if (!key || !isUUID(key))
      invalid('Header Idempotency-Key wajib berupa UUID.');
    key = key.toLowerCase();
    target = target.toLowerCase();
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ operation, target, payload }))
      .digest('hex');
    return this.transaction(async (tx) => {
      // A shared ledger namespace prevents the same key being reused across payment and reversal targets.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},72823))`;
      const previous = await tx.paymentEntry.findUnique({
        where: { idempotencyKey: key },
      });
      if (previous) {
        if (
          previous.requestHash !== requestHash ||
          previous.recordedBy !== actor.userId
        )
          throw new ConflictException(
            'Idempotency-Key sudah digunakan untuk transaksi berbeda.',
          );
        return (
          await this.serialized(tx, [await this.find(tx, previous.id)])
        )[0];
      }
      const entry = await work(tx, key, requestHash);
      return (await this.serialized(tx, [await this.find(tx, entry.id)]))[0];
    });
  }
  async lockedMember(tx: Tx, memberId: string) {
    const reference = await tx.fineCaseMember.findUnique({
      where: { id: memberId },
      select: { fineCaseId: true },
    });
    if (!reference)
      throw new NotFoundException('Alokasi peserta tidak ditemukan.');
    await this.db.lockRow(tx, 'FineCase', reference.fineCaseId);
    await this.db.lockRow(tx, 'FineCaseMember', memberId);
    const member = await tx.fineCaseMember.findUnique({
      where: { id: memberId },
      include: { fineCase: true, entries: true },
    });
    if (!member)
      throw new NotFoundException(
        'Alokasi peserta sudah berubah. Muat ulang detail.',
      );
    if (member.fineCase.status !== 'POSTED')
      throw new ConflictException(
        'Pembayaran dan pembalikan hanya berlaku pada kejadian yang diposting.',
      );
    return member;
  }
  async pay(memberId: string, body: PaymentDto, key: string, actor: Actor) {
    memberId = memberId.toLowerCase();
    const data = {
      amount: body.amount,
      method: body.method,
      effectiveAt: new Date(body.effectiveAt).toISOString(),
      note: body.note?.trim() || null,
    };
    return this.mutate(
      key,
      'PAYMENT',
      memberId,
      data,
      actor,
      async (tx, idempotencyKey, requestHash) => {
        const m = await this.lockedMember(tx, memberId);
        if (new Date(data.effectiveAt).getTime() > Date.now() + 300000)
          invalid('Tanggal pembayaran maksimal 5 menit dari sekarang.');
        const net = ledgerTotal(m.entries),
          remaining = BigInt(m.assignedAmount ?? 0) - net;
        if (
          m.assignedAmount === null ||
          net < 0n ||
          net > BigInt(m.assignedAmount)
        )
          throw new ConflictException(
            'Saldo ledger tidak konsisten. Periksa histori sebelum melanjutkan.',
          );
        if (BigInt(data.amount) > remaining)
          invalid(
            'Nominal pembayaran melebihi sisa denda. Muat saldo terbaru.',
          );
        const entry = await tx.paymentEntry.create({
          data: {
            ...data,
            effectiveAt: new Date(data.effectiveAt),
            kind: 'PAYMENT',
            fineCaseMemberId: memberId,
            idempotencyKey,
            requestHash,
            recordedBy: actor.userId,
          },
        });
        await tx.fineCase.update({
          where: { id: m.fineCaseId },
          data: { version: { increment: 1 } },
        });
        await this.audit(
          tx,
          actor,
          entry,
          m.fineCaseId,
          net,
          net + BigInt(entry.amount),
        );
        return entry;
      },
    );
  }
  async reverse(
    paymentId: string,
    body: ReverseDto,
    key: string,
    actor: Actor,
  ) {
    paymentId = paymentId.toLowerCase();
    const data = {
      reason: body.reason.trim(),
      effectiveAt: new Date(body.effectiveAt).toISOString(),
    };
    return this.mutate(
      key,
      'REVERSAL',
      paymentId,
      data,
      actor,
      async (tx, idempotencyKey, requestHash) => {
        const original = await this.find(tx, paymentId);
        const m = await this.lockedMember(tx, original.fineCaseMemberId);
        if (original.kind !== 'PAYMENT')
          throw new ConflictException(
            'Entri pembalikan tidak dapat dibalik kembali.',
          );
        if (
          await tx.paymentEntry.findUnique({
            where: { originalPaymentId: paymentId },
          })
        )
          throw new ConflictException('Pembayaran sudah dibalik.');
        const effectiveAt = new Date(data.effectiveAt);
        if (
          effectiveAt < original.effectiveAt ||
          effectiveAt.getTime() > Date.now()
        )
          invalid(
            'Tanggal pembalikan harus sama atau sesudah pembayaran asli dan tidak di masa depan.',
          );
        const net = ledgerTotal(m.entries);
        if (
          m.assignedAmount === null ||
          net < 0n ||
          net > BigInt(m.assignedAmount)
        )
          throw new ConflictException(
            'Saldo ledger tidak konsisten. Periksa histori sebelum melanjutkan.',
          );
        if (net < BigInt(original.amount))
          throw new ConflictException(
            'Saldo ledger tidak konsisten. Periksa histori sebelum melanjutkan.',
          );
        const entry = await tx.paymentEntry.create({
          data: {
            kind: 'REVERSAL',
            amount: original.amount,
            effectiveAt,
            note: data.reason,
            originalPaymentId: paymentId,
            fineCaseMemberId: m.id,
            idempotencyKey,
            requestHash,
            recordedBy: actor.userId,
          },
        });
        await tx.fineCase.update({
          where: { id: m.fineCaseId },
          data: { version: { increment: 1 } },
        });
        await this.audit(
          tx,
          actor,
          entry,
          m.fineCaseId,
          net,
          net - BigInt(original.amount),
        );
        return entry;
      },
    );
  }
}
