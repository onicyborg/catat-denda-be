import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PageResult } from '../pagination.js';
import { financials, ledgerTotal, settlement } from './calculations.js';
import {
  FineCreateDto,
  FineUpdateDto,
  FineQuery,
  FineMemberDto,
} from './dto.js';
import type { Actor } from '../master/repository.js';
const include = {
  violationType: true,
  members: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: {
      employee: true,
      entries: {
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      },
    },
  },
} satisfies Prisma.FineCaseInclude;
type Case = Prisma.FineCaseGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
const invalid = (message: string) => {
  throw new UnprocessableEntityException(message);
};
const clean = (b: FineCreateDto) => ({
  occurredAt: b.occurredAt ? new Date(b.occurredAt) : null,
  violationTypeId: b.violationTypeId ?? null,
  description: b.description?.trim() || null,
  sourceText: b.sourceText || null,
});
function serialize(c: Case) {
  const hasLedgerHistory = c.members.some((m) => m.entries.length > 0);
  return {
    ...c,
    creation: undefined,
    displayCode: `DND-${String(c.caseNumber).padStart(6, '0')}`,
    currency: 'IDR',
    ...financials(c.status, c.members),
    hasLedgerHistory,
    canEditFinancial: c.status !== 'VOIDED' && !hasLedgerHistory,
    canVoid:
      c.status !== 'VOIDED' &&
      c.members.every((m) => ledgerTotal(m.entries) === 0n),
    members: c.members.map((m) => {
      const paid = c.status === 'POSTED' ? ledgerTotal(m.entries) : 0n;
      const amount = c.status === 'POSTED' ? BigInt(m.assignedAmount ?? 0) : 0n;
      return {
        ...m,
        employee: undefined,
        entries: m.entries.map(
          ({
            id,
            kind,
            amount,
            method,
            effectiveAt,
            createdAt,
            recordedBy,
            originalPaymentId,
            note,
          }) => ({
            id,
            kind,
            amount,
            method,
            effectiveAt,
            createdAt,
            recordedBy,
            originalPaymentId,
            note,
          }),
        ),
        employeeDisplayName:
          m.employeeNameSnapshot ??
          m.employee?.displayName ??
          m.rawEmployeeName ??
          'Peserta belum ditentukan',
        employeeIsActive: m.employee?.isActive ?? null,
        netPaidAmount: paid.toString(),
        outstandingAmount: (amount - paid).toString(),
        settlementStatus:
          c.status === 'POSTED' ? settlement(amount, paid) : null,
      };
    }),
  };
}
function auditState(c: Case): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      id: c.id,
      caseNumber: c.caseNumber,
      status: c.status,
      version: c.version,
      occurredAt: c.occurredAt,
      violationTypeId: c.violationTypeId,
      violationCodeSnapshot: c.violationCodeSnapshot,
      violationNameSnapshot: c.violationNameSnapshot,
      violationCategorySnapshot: c.violationCategorySnapshot,
      defaultRateSnapshot: c.defaultRateSnapshot,
      description: c.description,
      sourceText: c.sourceText,
      postedBy: c.postedBy,
      postedAt: c.postedAt,
      voidedBy: c.voidedBy,
      voidedAt: c.voidedAt,
      voidReason: c.voidReason,
      members: c.members.map(
        ({
          id,
          employeeId,
          employeeNameSnapshot,
          rawEmployeeName,
          assignedAmount,
        }) => ({
          id,
          employeeId,
          employeeNameSnapshot,
          rawEmployeeName,
          assignedAmount,
        }),
      ),
    }),
  );
}
@Injectable()
export class FinesService {
  constructor(readonly db: PrismaService) {}
  audit(
    tx: Tx,
    actor: Actor,
    action: string,
    before: Case | null,
    after: Case,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        requestId: actor.requestId,
        action,
        entityType: 'FineCase',
        entityId: after.id,
        beforeJson: before ? auditState(before) : undefined,
        afterJson: auditState(after),
      },
    });
  }
  async find(tx: Tx, id: string) {
    const c = await tx.fineCase.findUnique({ where: { id }, include });
    if (!c) throw new NotFoundException('Kejadian tidak ditemukan.');
    return c;
  }
  async locked(tx: Tx, id: string, version: number) {
    await this.db.lockRow(tx, 'FineCase', id);
    const c = await this.find(tx, id);
    for (const m of [...c.members].sort((a, b) => a.id.localeCompare(b.id)))
      await this.db.lockRow(tx, 'FineCaseMember', m.id);
    if (c.version !== version)
      throw new ConflictException(
        'Data sudah berubah. Buka ulang detail sebelum menyimpan.',
      );
    if (c.status === 'VOIDED')
      throw new ConflictException(
        'Kejadian sudah dibatalkan dan tidak dapat diubah.',
      );
    return c;
  }
  async refs(tx: Tx, typeId: string | null, members: FineMemberDto[]) {
    if (!Array.isArray(members)) invalid('Peserta harus berupa daftar.');
    const ids = members.flatMap((m) => (m.employeeId ? [m.employeeId] : []));
    if (new Set(ids).size !== ids.length)
      invalid('Karyawan yang sama tidak boleh dipilih dua kali.');
    if (
      typeId &&
      !(await tx.violationType.findUnique({ where: { id: typeId } }))
    )
      invalid('Jenis kesalahan tidak ditemukan.');
    if (
      (await tx.employee.count({ where: { id: { in: ids } } })) !== ids.length
    )
      invalid('Karyawan tidak ditemukan.');
  }
  async create(body: FineCreateDto, key: string, actor: Actor) {
    if (!key || !isUUID(key))
      invalid('Header Idempotency-Key wajib berupa UUID.');
    key = key.toLowerCase();
    const data = clean(body);
    const members = (body.members ?? []).map((m) => ({
      employeeId: m.employeeId ?? null,
      rawEmployeeName: m.rawEmployeeName?.trim() || null,
      assignedAmount: m.assignedAmount ?? null,
    }));
    if (body.members === null) invalid('Peserta harus berupa daftar.');
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ data, members }))
      .digest('hex');
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 72822))`;
      const previous = await tx.fineCaseCreation.findUnique({ where: { key } });
      if (previous) {
        if (
          previous.actorUserId !== actor.userId ||
          previous.requestHash !== requestHash
        )
          throw new ConflictException(
            'Idempotency-Key sudah digunakan untuk permintaan berbeda.',
          );
        return serialize(await this.find(tx, previous.fineCaseId));
      }
      await this.refs(tx, data.violationTypeId, members);
      const c = await tx.fineCase.create({
        data: {
          ...data,
          createdBy: actor.userId,
          members: { create: members },
          creation: { create: { key, actorUserId: actor.userId, requestHash } },
        },
        include,
      });
      await this.audit(tx, actor, 'FINE_CREATE', null, c);
      return serialize(c);
    });
  }
  async get(id: string) {
    return serialize(await this.find(this.db, id));
  }
  async list(q: FineQuery) {
    if (q.from && q.to && q.from > q.to)
      invalid('Tanggal awal harus sebelum tanggal akhir.');
    const contains = q.q
      ? { contains: q.q, mode: 'insensitive' as const }
      : undefined;
    const number = q.q?.match(/^DND-0*(\d+)$/i)?.[1];
    const where: Prisma.FineCaseWhereInput = {
      status: q.status,
      violationTypeId: q.violationTypeId,
      members: q.employeeId
        ? { some: { employeeId: q.employeeId } }
        : undefined,
      occurredAt:
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
      OR: contains
        ? [
            { description: contains },
            { sourceText: contains },
            { violationNameSnapshot: contains },
            { violationType: { name: contains } },
            {
              members: {
                some: {
                  OR: [
                    { employeeNameSnapshot: contains },
                    { rawEmployeeName: contains },
                    {
                      employee: {
                        OR: [
                          { displayName: contains },
                          { aliases: { some: { aliasDisplay: contains } } },
                        ],
                      },
                    },
                  ],
                },
              },
            },
            ...(number && Number(number) <= 2147483647
              ? [{ caseNumber: Number(number) }]
              : []),
          ]
        : undefined,
    };
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.fineCase.count({ where });
        const rows = await tx.fineCase.findMany({
          where,
          include,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        });
        return new PageResult(rows.map(serialize), {
          page: q.page,
          limit: q.limit,
          total,
          totalPages: Math.ceil(total / q.limit),
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async validatePost(tx: Tx, c: Case, initial: boolean, old?: Case) {
    if (!c.occurredAt || c.occurredAt.getTime() > Date.now() + 300000)
      invalid(
        'Tanggal kejadian wajib diisi dan maksimal 5 menit dari sekarang.',
      );
    if (!c.description || c.description.length < 3)
      invalid('Deskripsi kejadian minimal 3 karakter.');
    if (!c.violationTypeId) invalid('Pilih jenis kesalahan aktif.');
    if (!c.members.length || c.members.length > 20)
      invalid('Posting memerlukan 1 sampai 20 peserta.');
    const typeChanged = initial || old?.violationTypeId !== c.violationTypeId;
    await this.db.lockRow(tx, 'ViolationType', c.violationTypeId!);
    const type = await tx.violationType.findUniqueOrThrow({
      where: { id: c.violationTypeId! },
    });
    if (typeChanged && !type.isActive)
      invalid('Jenis kesalahan sudah diarsipkan.');
    for (const m of [...c.members].sort((a, b) =>
      (a.employeeId ?? '').localeCompare(b.employeeId ?? ''),
    )) {
      if (
        !m.employeeId ||
        m.assignedAmount === null ||
        m.assignedAmount < 1 ||
        m.assignedAmount > 100000000
      )
        invalid(
          'Setiap peserta harus terhubung dengan karyawan dan memiliki nominal integer positif.',
        );
      await this.db.lockRow(tx, 'Employee', m.employeeId!);
      const employee = await tx.employee.findUniqueOrThrow({
        where: { id: m.employeeId! },
      });
      const changed =
        initial || !old?.members.some((o) => o.employeeId === m.employeeId);
      if (changed && !employee.isActive)
        invalid('Karyawan yang dipilih sudah diarsipkan.');
      if (changed)
        await tx.fineCaseMember.update({
          where: { id: m.id },
          data: { employeeNameSnapshot: employee.displayName },
        });
    }
    if (typeChanged)
      await tx.fineCase.update({
        where: { id: c.id },
        data: {
          violationCodeSnapshot: type.code,
          violationNameSnapshot: type.name,
          violationCategorySnapshot: type.category,
          defaultRateSnapshot: type.defaultAmountPerPerson,
        },
      });
  }
  async post(id: string, version: number, actor: Actor) {
    return this.db.$transaction(async (tx) => {
      const before = await this.locked(tx, id, version);
      if (before.status !== 'DRAFT')
        throw new ConflictException('Hanya draft yang dapat diposting.');
      await this.validatePost(tx, before, true);
      await tx.fineCase.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedBy: actor.userId,
          version: { increment: 1 },
        },
      });
      const after = await this.find(tx, id);
      await this.audit(tx, actor, 'FINE_POST', before, after);
      return serialize(after);
    });
  }
  async update(id: string, body: FineUpdateDto, actor: Actor) {
    return this.db.$transaction(async (tx) => {
      const before = await this.locked(tx, id, body.version);
      const history = before.members.some((m) => m.entries.length > 0);
      if (
        before.status === 'POSTED' &&
        (body.sourceText !== undefined ||
          (history &&
            Object.keys(
              Object.fromEntries(
                Object.entries(body).filter(([, value]) => value !== undefined),
              ),
            ).some((k) => k !== 'version' && k !== 'description')))
      )
        throw new ConflictException(
          'Setelah ada ledger hanya deskripsi yang boleh dikoreksi. Teks sumber posting tidak dapat diubah.',
        );
      const data = clean({
        ...before,
        occurredAt: before.occurredAt?.toISOString(),
        ...Object.fromEntries(
          Object.entries(body).filter(([, value]) => value !== undefined),
        ),
      });
      const members = body.members ?? before.members;
      if (body.members === null) invalid('Peserta harus berupa daftar.');
      await this.refs(tx, data.violationTypeId, members);
      await tx.fineCase.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
      });
      if (body.members) {
        const remaining = [...before.members];
        const plans = body.members.map((m) => {
          const index = remaining.findIndex((o) =>
            m.employeeId
              ? o.employeeId === m.employeeId
              : !o.employeeId &&
                o.rawEmployeeName === (m.rawEmployeeName ?? null),
          );
          const existing =
            index >= 0 ? remaining.splice(index, 1)[0] : undefined;
          return { m, existing };
        });
        if (remaining.some((m) => m.entries.length))
          throw new ConflictException(
            'Alokasi dengan histori ledger tidak dapat dihapus.',
          );
        await tx.fineCaseMember.deleteMany({
          where: { id: { in: remaining.map((m) => m.id) } },
        });
        for (const { m, existing } of plans) {
          const values = {
            employeeId: m.employeeId ?? null,
            rawEmployeeName: m.rawEmployeeName?.trim() || null,
            assignedAmount: m.assignedAmount ?? null,
          };
          if (existing)
            await tx.fineCaseMember.update({
              where: { id: existing.id },
              data: values,
            });
          else
            await tx.fineCaseMember.create({
              data: { fineCaseId: id, ...values },
            });
        }
      }
      if (before.status === 'POSTED')
        await this.validatePost(tx, await this.find(tx, id), false, before);
      const after = await this.find(tx, id);
      await this.audit(tx, actor, 'FINE_UPDATE', before, after);
      return serialize(after);
    });
  }
  async void(id: string, version: number, reason: string, actor: Actor) {
    return this.db.$transaction(async (tx) => {
      const before = await this.locked(tx, id, version);
      if (before.members.some((m) => ledgerTotal(m.entries) !== 0n))
        throw new ConflictException(
          'Pembayaran aktif harus dibalik sebelum kejadian dibatalkan.',
        );
      await tx.fineCase.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidReason: reason.trim(),
          voidedAt: new Date(),
          voidedBy: actor.userId,
          version: { increment: 1 },
        },
      });
      const after = await this.find(tx, id);
      await this.audit(tx, actor, 'FINE_VOID', before, after);
      return serialize(after);
    });
  }
}
