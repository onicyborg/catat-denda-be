import {
  Injectable,
  NotFoundException,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PageResult } from '../pagination.js';
import { settlement as paidStatus } from '../fines/calculations.js';
import { SettingsService } from './settings.service.js';
import { period, wibCsv } from './period.js';
import { csv, fineHeaders, paymentHeaders } from './csv.js';
import {
  BalanceQuery,
  CaseReportQuery,
  ExportStatus,
  PaymentExportQuery,
  ReportQuery,
} from './dto.js';
import type { Actor } from '../master/repository.js';
type Tx = Prisma.TransactionClient;
const filterValues = (q: ReportQuery) => ({
  from: q.from,
  to: q.to,
  employeeId: q.employeeId,
  violationTypeId: q.violationTypeId,
});
const code = (n: number) => `DND-${String(n).padStart(6, '0')}`;
const pageMeta = (q: { page: number; limit: number }, total: string) => {
  const n = Number(total);
  if (!Number.isSafeInteger(n)) throw new Error('Count exceeds safe integer');
  return {
    page: q.page,
    limit: q.limit,
    total: n,
    totalPages: Math.ceil(n / q.limit),
  };
};
type Metrics = {
  caseCount: string;
  allocationCount: string;
  assessedAmount: string;
  cohortNetPaidAmount: string;
  cohortOutstandingAmount: string;
  periodNetPaidAmount: string;
  currentOutstandingAmount: string;
};
type Balance = {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  isActive: boolean;
  caseCount: string;
  allocationCount: string;
  assessedAmount: string;
  netPaidAmount: string;
  outstandingAmount: string;
};
type CaseRow = {
  id: string;
  caseNumber: number;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  occurredAt: Date | null;
  description: string | null;
  violationName: string | null;
  allocationCount: string;
  previewAmount: string;
  unknownAmountCount: string;
  assessedAmount: string;
  netPaidAmount: string;
  outstandingAmount: string;
};
@Injectable()
export class ReportsService {
  constructor(
    readonly db: PrismaService,
    private settings: SettingsService,
    private config: ConfigService,
  ) {}
  base() {
    const f = this.db.relation('FineCase'),
      m = this.db.relation('FineCaseMember'),
      p = this.db.relation('PaymentEntry');
    return Prisma.sql`WITH ledger AS (SELECT "fineCaseMemberId",SUM(CASE WHEN kind='PAYMENT' THEN amount ELSE -amount END)::bigint AS paid FROM ${p} GROUP BY "fineCaseMemberId"), allocations AS (SELECT m.id AS "memberId",m."fineCaseId" AS "caseId",m."employeeId",m."assignedAmount",m."employeeNameSnapshot",m."rawEmployeeName",COALESCE(l.paid,0)::bigint AS "netPaid",c.status,c."occurredAt",c."violationTypeId" FROM ${m} m JOIN ${f} c ON c.id=m."fineCaseId" LEFT JOIN ledger l ON l."fineCaseMemberId"=m.id)`;
  }
  refs(
    q: ReportQuery,
    memberAlias: Prisma.Sql = Prisma.raw('a'),
    caseAlias: Prisma.Sql = Prisma.raw('a'),
  ) {
    return Prisma.sql`${q.employeeId ? Prisma.sql`AND ${memberAlias}."employeeId"=${q.employeeId}::uuid` : Prisma.empty} ${q.violationTypeId ? Prisma.sql`AND ${caseAlias}."violationTypeId"=${q.violationTypeId}::uuid` : Prisma.empty}`;
  }
  dates(q: ReportQuery, alias: Prisma.Sql = Prisma.raw('a')) {
    const p = period(q);
    return Prisma.sql`${alias}."occurredAt">=${p.start} AND ${alias}."occurredAt"<${p.end}`;
  }
  async summaryTx(tx: Tx, q: ReportQuery) {
    const p = period(q),
      m = this.db.relation('FineCaseMember'),
      f = this.db.relation('FineCase'),
      payment = this.db.relation('PaymentEntry');
    const [metrics] = await tx.$queryRaw<Metrics[]>(
      Prisma.sql`${this.base()},cohort AS (SELECT * FROM allocations a WHERE a.status='POSTED' AND ${this.dates(q)} ${this.refs(q)}) SELECT (SELECT COUNT(DISTINCT "caseId")::text FROM cohort) AS "caseCount",(SELECT COUNT(*)::text FROM cohort) AS "allocationCount",(SELECT COALESCE(SUM("assignedAmount"),0)::text FROM cohort) AS "assessedAmount",(SELECT COALESCE(SUM("netPaid"),0)::text FROM cohort) AS "cohortNetPaidAmount",(SELECT COALESCE(SUM("assignedAmount"-"netPaid"),0)::text FROM cohort) AS "cohortOutstandingAmount",(SELECT COALESCE(SUM(a."assignedAmount"-a."netPaid"),0)::text FROM allocations a WHERE a.status='POSTED' ${this.refs(q)}) AS "currentOutstandingAmount",(SELECT COALESCE(SUM(CASE WHEN p.kind='PAYMENT' THEN p.amount ELSE -p.amount END),0)::text FROM ${payment} p JOIN ${m} m ON m.id=p."fineCaseMemberId" JOIN ${f} c ON c.id=m."fineCaseId" WHERE p."effectiveAt">=${p.start} AND p."effectiveAt"<${p.end} ${this.refs(q, Prisma.raw('m'), Prisma.raw('c'))}) AS "periodNetPaidAmount"`,
    );
    const settings = await this.settings.read(tx);
    return {
      ...metrics,
      businessName: settings.businessName,
      from: p.from,
      to: p.to,
      timezone: 'Asia/Jakarta',
      currency: 'IDR',
      employeeId: q.employeeId ?? null,
      violationTypeId: q.violationTypeId ?? null,
      generatedAt: new Date().toISOString(),
      exportMaxDays: this.config.getOrThrow<number>('CSV_MAX_DAYS'),
      exportMaxRows: this.config.getOrThrow<number>('CSV_MAX_ROWS'),
    };
  }
  summary(q: ReportQuery) {
    return this.db.$transaction((tx) => this.summaryTx(tx, q), {
      isolationLevel: 'RepeatableRead',
    });
  }
  async balancesTx(tx: Tx, q: BalanceQuery, allDates = false) {
    const employees = this.db.relation('Employee');
    const where = Prisma.sql`a.status='POSTED' AND a."employeeId" IS NOT NULL ${allDates ? Prisma.empty : Prisma.sql`AND ${this.dates(q)}`} ${this.refs(q)}`;
    const [count] = await tx.$queryRaw<{ total: string }[]>(
      Prisma.sql`${this.base()} SELECT COUNT(DISTINCT a."employeeId")::text AS total FROM allocations a WHERE ${where}`,
    );
    const data = await tx.$queryRaw<Balance[]>(
      Prisma.sql`${this.base()} SELECT a."employeeId",e."displayName" AS "employeeName",e."employeeCode",e."isActive",COUNT(DISTINCT a."caseId")::text AS "caseCount",COUNT(*)::text AS "allocationCount",SUM(a."assignedAmount")::text AS "assessedAmount",SUM(a."netPaid")::text AS "netPaidAmount",SUM(a."assignedAmount"-a."netPaid")::text AS "outstandingAmount" FROM allocations a JOIN ${employees} e ON e.id=a."employeeId" WHERE ${where} GROUP BY a."employeeId",e."displayName",e."employeeCode",e."isActive" ORDER BY SUM(a."assignedAmount"-a."netPaid") DESC,e."displayName",a."employeeId" LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    );
    return new PageResult(data, pageMeta(q, count.total));
  }
  balances(q: BalanceQuery) {
    return this.db.$transaction((tx) => this.balancesTx(tx, q), {
      isolationLevel: 'RepeatableRead',
    });
  }
  caseWhere(q: CaseReportQuery, dated = true) {
    const p = period(q);
    return Prisma.sql`TRUE ${q.status === 'ALL' ? Prisma.empty : Prisma.sql`AND c.status::text=${q.status}`} ${dated ? Prisma.sql`AND ((c."occurredAt">=${p.start} AND c."occurredAt"<${p.end}) ${q.includeUndated ? Prisma.sql`OR c."occurredAt" IS NULL` : Prisma.empty})` : Prisma.empty} ${this.refs(q, Prisma.raw('a'), Prisma.raw('c'))}`;
  }
  async casesTx(tx: Tx, q: CaseReportQuery, dated = true) {
    const f = this.db.relation('FineCase');
    const join = Prisma.sql`FROM ${f} c LEFT JOIN allocations a ON a."caseId"=c.id WHERE ${this.caseWhere(q, dated)}`;
    const [count] = await tx.$queryRaw<{ total: string }[]>(
      Prisma.sql`${this.base()} SELECT COUNT(DISTINCT c.id)::text AS total ${join}`,
    );
    const rows = await tx.$queryRaw<CaseRow[]>(
      Prisma.sql`${this.base()} SELECT c.id,c."caseNumber",c.status,c."occurredAt",c.description,c."violationNameSnapshot" AS "violationName",COUNT(a."memberId")::text AS "allocationCount",COALESCE(SUM(a."assignedAmount"),0)::text AS "previewAmount",COUNT(a."memberId") FILTER(WHERE a."assignedAmount" IS NULL)::text AS "unknownAmountCount",CASE WHEN c.status='POSTED' THEN COALESCE(SUM(a."assignedAmount"),0) ELSE 0 END::text AS "assessedAmount",CASE WHEN c.status='POSTED' THEN COALESCE(SUM(a."netPaid"),0) ELSE 0 END::text AS "netPaidAmount",CASE WHEN c.status='POSTED' THEN COALESCE(SUM(a."assignedAmount"-a."netPaid"),0) ELSE 0 END::text AS "outstandingAmount" ${join} GROUP BY c.id ORDER BY c."occurredAt" DESC NULLS LAST,c."createdAt" DESC,c.id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    );
    return new PageResult(
      rows.map((row) => ({ ...row, caseCode: code(row.caseNumber) })),
      pageMeta(q, count.total),
    );
  }
  cases(q: CaseReportQuery) {
    return this.db.$transaction((tx) => this.casesTx(tx, q), {
      isolationLevel: 'RepeatableRead',
    });
  }
  dashboard(q: ReportQuery) {
    return this.db.$transaction(
      async (tx) => {
        const summary = await this.summaryTx(tx, q),
          base = {
            ...filterValues(q),
            page: 1,
            limit: 5,
            includeUndated: true,
          };
        const recent = await this.casesTx(
            tx,
            { ...base, status: ExportStatus.POSTED },
            false,
          ),
          drafts = await this.casesTx(
            tx,
            { ...base, status: ExportStatus.DRAFT },
            false,
          ),
          top = await this.balancesTx(
            tx,
            {
              ...filterValues(q),
              page: 1,
              limit: 5,
            },
            true,
          );
        return {
          summary,
          recentCases: recent.data,
          drafts: drafts.data,
          draftCount: String(drafts.meta.total),
          topOutstanding: top.data.filter(
            (e) => BigInt(e.outstandingAmount) > 0n,
          ),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  employee(id: string, q: ReportQuery) {
    return this.db.$transaction(
      async (tx) => {
        if (
          !(await tx.employee.findUnique({
            where: { id },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Karyawan tidak ditemukan.');
        return this.summaryTx(tx, {
          ...filterValues(q),
          employeeId: id,
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  exportLimits(q: ReportQuery) {
    const p = period(q),
      maxDays = this.config.getOrThrow<number>('CSV_MAX_DAYS');
    if ((p.end.getTime() - p.start.getTime()) / 86400000 > maxDays)
      throw new UnprocessableEntityException(
        `Rentang ekspor maksimal ${maxDays} hari. Persempit rentang tanggal.`,
      );
    return { p, maxRows: this.config.getOrThrow<number>('CSV_MAX_ROWS') };
  }
  exportAudit(
    tx: Tx,
    actor: Actor,
    action: string,
    filters: Prisma.InputJsonValue,
    rowCount: number,
  ) {
    return tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        requestId: actor.requestId,
        action,
        entityType: 'ReportExport',
        entityId: randomUUID(),
        afterJson: { filters, rowCount, format: 'CSV' },
      },
    });
  }
  async exportCases(q: CaseReportQuery, actor: Actor) {
    const { p, maxRows } = this.exportLimits(q);
    return this.db.$transaction(
      async (tx) => {
        const f = this.db.relation('FineCase'),
          employees = this.db.relation('Employee');
        type Row = {
          caseNumber: number;
          occurredAt: Date | null;
          status: string;
          violationCode: string | null;
          violationName: string | null;
          description: string | null;
          employeeCode: string | null;
          employeeName: string | null;
          assigned: number | null;
          paid: bigint;
          createdAt: Date;
        };
        const rows = await tx.$queryRaw<Row[]>(
          Prisma.sql`${this.base()} SELECT c."caseNumber",c."occurredAt",c.status,c."violationCodeSnapshot" AS "violationCode",c."violationNameSnapshot" AS "violationName",c.description,e."employeeCode",COALESCE(a."employeeNameSnapshot",a."rawEmployeeName",e."displayName") AS "employeeName",a."assignedAmount" AS assigned,a."netPaid" AS paid,c."createdAt" FROM ${f} c JOIN allocations a ON a."caseId"=c.id LEFT JOIN ${employees} e ON e.id=a."employeeId" WHERE ${this.caseWhere(q)} ORDER BY c."occurredAt" DESC NULLS LAST,c.id,a."memberId" LIMIT ${maxRows + 1}`,
        );
        if (rows.length > maxRows)
          throw new UnprocessableEntityException(
            `Hasil ekspor melebihi ${maxRows} baris. Persempit filter; tidak ada data yang dipotong.`,
          );
        const body = csv(
          fineHeaders,
          rows.map((r) => [
            code(r.caseNumber),
            wibCsv(r.occurredAt),
            r.status,
            r.violationCode,
            r.violationName,
            r.description,
            r.employeeCode,
            r.employeeName,
            r.assigned,
            r.status === 'POSTED' ? r.paid : null,
            r.status === 'POSTED' ? BigInt(r.assigned ?? 0) - r.paid : null,
            r.status === 'POSTED'
              ? paidStatus(BigInt(r.assigned ?? 0), r.paid)
              : null,
            wibCsv(r.createdAt),
          ]),
        );
        await this.exportAudit(
          tx,
          actor,
          'EXPORT_FINE_CASES',
          {
            from: p.from,
            to: p.to,
            status: q.status,
            includeUndated: q.includeUndated,
            employeeId: q.employeeId ?? null,
            violationTypeId: q.violationTypeId ?? null,
          },
          rows.length,
        );
        return this.file(body, 'fine-cases', p);
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
  async exportPayments(q: PaymentExportQuery, actor: Actor) {
    const { p, maxRows } = this.exportLimits(q);
    return this.db.$transaction(
      async (tx) => {
        const payments = this.db.relation('PaymentEntry'),
          m = this.db.relation('FineCaseMember'),
          f = this.db.relation('FineCase');
        type Row = {
          id: string;
          caseNumber: number;
          employeeName: string | null;
          kind: string;
          amount: number;
          method: string | null;
          effectiveAt: Date;
          createdAt: Date;
          originalPaymentId: string | null;
          note: string | null;
          recordedBy: string;
        };
        const rows = await tx.$queryRaw<Row[]>(
          Prisma.sql`SELECT p.id,c."caseNumber",m."employeeNameSnapshot" AS "employeeName",p.kind,p.amount,p.method,p."effectiveAt",p."createdAt",p."originalPaymentId",p.note,p."recordedBy" FROM ${payments} p JOIN ${m} m ON m.id=p."fineCaseMemberId" JOIN ${f} c ON c.id=m."fineCaseId" WHERE p."effectiveAt">=${p.start} AND p."effectiveAt"<${p.end} ${this.refs(q, Prisma.raw('m'), Prisma.raw('c'))} ${q.kind ? Prisma.sql`AND p.kind::text=${q.kind}` : Prisma.empty} ORDER BY p."effectiveAt" DESC,p."createdAt" DESC,p.id DESC LIMIT ${maxRows + 1}`,
        );
        if (rows.length > maxRows)
          throw new UnprocessableEntityException(
            `Hasil ekspor melebihi ${maxRows} baris. Persempit filter; tidak ada data yang dipotong.`,
          );
        const body = csv(
          paymentHeaders,
          rows.map((r) => [
            r.id,
            code(r.caseNumber),
            r.employeeName,
            r.kind,
            r.amount,
            r.kind === 'PAYMENT' ? BigInt(r.amount) : -BigInt(r.amount),
            r.method,
            wibCsv(r.effectiveAt),
            wibCsv(r.createdAt),
            r.originalPaymentId,
            r.note,
            r.recordedBy,
          ]),
        );
        await this.exportAudit(
          tx,
          actor,
          'EXPORT_PAYMENTS',
          {
            from: p.from,
            to: p.to,
            employeeId: q.employeeId ?? null,
            violationTypeId: q.violationTypeId ?? null,
            kind: q.kind ?? null,
          },
          rows.length,
        );
        return this.file(body, 'payments', p);
      },
      { isolationLevel: 'RepeatableRead', timeout: 15000 },
    );
  }
  file(body: string, name: string, p: { from: string; to: string }) {
    const buffer = Buffer.from(body, 'utf8');
    return new StreamableFile(buffer, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${name}_${p.from}_${p.to}.csv"`,
      length: buffer.length,
    });
  }
}
