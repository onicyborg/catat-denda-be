import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import * as argon2 from 'argon2';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { ReportsService } from '../dist/reporting/reports.service.js';
import { SettingsService } from '../dist/reporting/settings.service.js';
import { ConfigService } from '@nestjs/config';
import { csv } from '../dist/reporting/csv.js';
import { readFile } from 'node:fs/promises';
import { fixtureDraft } from './fixtures-fines.mjs';
const schema = 'qa_' + randomBytes(6).toString('hex');
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.APP_BASE_URL = 'http://localhost:3000';
execFileSync('pnpm', ['prisma:deploy'], { env: process.env, stdio: 'pipe' });
const { AppModule } = await import('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false });
configure(app);
await app.init();
const db = app.get(PrismaService),
  http = app.getHttpServer();
try {
  const password = randomBytes(20).toString('hex');
  const admin = await db.user.create({
    data: { username: 'master.qa', passwordHash: await argon2.hash(password) },
  });
  for (const path of ['employees', 'violation-types'])
    await request(http)
      .get('/api/v1/' + path)
      .expect(401);
  const login = await request(http)
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_BASE_URL)
    .send({ username: 'master.qa', password })
    .expect(201);
  const cookie = login.headers['set-cookie'][0].split(';')[0],
    csrf = login.body.data.csrfToken;
  const read = (path) =>
    request(http)
      .get('/api/v1' + path)
      .set('Cookie', cookie);
  const write = (method, path, body) =>
    request(http)
      [method]('/api/v1' + path)
      .set('Cookie', cookie)
      .set('Origin', process.env.APP_BASE_URL)
      .set('X-CSRF-Token', csrf)
      .send(body);
  const parseCsv = (text) =>
    JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          'import csv,io,json,sys; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read().lstrip("\\ufeff"))))))',
        ],
        { input: text, encoding: 'utf8' },
      ),
    );
  const period = 'from=2026-01-01&to=2026-01-31';
  const employees = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      db.employee.create({
        data: {
          displayName: i ? 'Report Person ' + i : '=SUM(1,2)',
          normalizedName: 'report ' + i,
          employeeCode: 'R' + i,
        },
      }),
    ),
  );
  const type = await db.violationType.create({
    data: {
      code: 'REPORT',
      name: 'Jenis report',
      category: 'OTHER',
      defaultAmountPerPerson: 5000,
    },
  });
  const create = async (data) =>
    (
      await write('post', '/fine-cases', data)
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body.data;
  const post = async (c) =>
    (
      await write('post', `/fine-cases/${c.id}/post`, {
        version: c.version,
      }).expect(201)
    ).body.data;
  const get = async (path) => (await read(path).expect(200)).body.data;
  let c = await post(
    await create({
      occurredAt: '2025-12-31T17:00:00Z',
      violationTypeId: type.id,
      description: '=A1+B1,"quoted"\nBaris berikutnya',
      members: employees.map((e) => ({
        employeeId: e.id,
        assignedAmount: 5000,
      })),
    }),
  );
  const member = c.members.find((m) => m.employeeId === employees[0].id);
  const payment = async (amount, date) =>
    (
      await write('post', `/fine-members/${member.id}/payments`, {
        amount,
        method: 'CASH',
        effectiveAt: date,
        note: '=HYPERLINK("example")',
      })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body.data;
  const first = await payment(2000, '2026-01-31T17:00:00Z');
  await payment(1000, '2026-02-02T00:00:00+07:00');
  await write('post', `/payments/${first.id}/reverse`, {
    reason: 'Pembayaran pertama salah',
    effectiveAt: '2026-03-01T00:00:00+07:00',
  })
    .set('Idempotency-Key', randomUUID())
    .expect(201);
  await create({});
  const unknown = await create({
    sourceText: 'Sumber belum lengkap',
    members: [{ rawEmployeeName: 'Nama sumber', assignedAmount: null }],
  });
  const initial = await get('/reports/summary?' + period);
  assert.equal(initial.caseCount, '1');
  assert.equal(initial.allocationCount, '4');
  assert.equal(initial.assessedAmount, '20000');
  assert.equal(initial.cohortNetPaidAmount, '1000');
  assert.equal(initial.cohortOutstandingAmount, '19000');
  assert.equal(initial.periodNetPaidAmount, '0');
  assert.equal(initial.currentOutstandingAmount, '19000');
  const feb = await get('/reports/summary?from=2026-02-01&to=2026-02-28');
  assert.equal(feb.assessedAmount, '0');
  assert.equal(feb.periodNetPaidAmount, '3000');
  assert.equal(feb.currentOutstandingAmount, '19000');
  const march = await get('/reports/summary?from=2026-03-01&to=2026-03-31');
  assert.equal(march.periodNetPaidAmount, '-2000');
  const filtered = await get(
    `/reports/summary?${period}&employeeId=${employees[0].id}`,
  );
  assert.equal(filtered.caseCount, '1');
  assert.equal(filtered.allocationCount, '1');
  assert.equal(filtered.assessedAmount, '5000');
  assert.equal(filtered.cohortNetPaidAmount, '1000');
  assert.equal(filtered.currentOutstandingAmount, '4000');
  const byEmployee = await get(
    `/employees/${employees[0].id}/summary?${period}`,
  );
  assert.equal(byEmployee.assessedAmount, '5000');
  const balance = (
    await read('/reports/employee-balances?' + period + '&limit=2').expect(200)
  ).body;
  assert.equal(balance.meta.total, 4);
  assert.equal(balance.data.length, 2);
  assert.equal(balance.data[0].outstandingAmount, '5000');
  const second = (
    await read(
      '/reports/employee-balances?' + period + '&limit=2&page=2',
    ).expect(200)
  ).body;
  assert(
    !balance.data.some((a) =>
      second.data.some((b) => a.employeeId === b.employeeId),
    ),
  );
  const caseReport = (await read('/reports/fine-cases?' + period).expect(200))
    .body;
  assert.equal(caseReport.meta.total, 1);
  assert.equal(caseReport.data[0].assessedAmount, '20000');
  assert.equal(caseReport.data[0].allocationCount, '4');
  const caseSelected = (
    await read(
      `/reports/fine-cases?${period}&employeeId=${employees[0].id}`,
    ).expect(200)
  ).body;
  assert.equal(caseSelected.data[0].assessedAmount, '5000');
  const dashboard = await get('/dashboard/summary?' + period);
  assert.equal(dashboard.summary.assessedAmount, '20000');
  assert.equal(dashboard.draftCount, '2');
  assert.equal(dashboard.drafts.length, 2);
  assert(
    dashboard.topOutstanding.every((e) => BigInt(e.outstandingAmount) > 0n),
  );
  assert.equal(
    (await get('/reports/summary?from=2025-12-31&to=2025-12-31')).caseCount,
    '0',
  );
  assert.equal(
    (await get('/reports/summary?from=2026-01-01&to=2026-01-01')).caseCount,
    '1',
  );
  const exported = await read('/reports/fine-cases.csv?' + period).expect(200);
  assert.match(exported.headers['content-type'], /text\/csv/);
  assert.equal(exported.headers['cache-control'], 'no-store');
  assert.match(
    exported.headers['content-disposition'],
    /^attachment; filename="fine-cases_2026-01-01_2026-01-31.csv"$/,
  );
  const rows = parseCsv(exported.text);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], [
    'case_code',
    'occurred_at_wib',
    'case_status',
    'violation_code',
    'violation_name_snapshot',
    'description',
    'employee_code',
    'employee_name_snapshot',
    'assigned_amount_idr',
    'net_paid_idr',
    'outstanding_idr',
    'settlement_status',
    'created_at_wib',
  ]);
  assert.equal(
    rows.slice(1).reduce((sum, row) => sum + BigInt(row[8]), 0n),
    20000n,
  );
  assert(rows.slice(1).every((r) => r[5].startsWith("'=")));
  assert(rows.slice(1).some((r) => r[7] === "'=SUM(1,2)"));
  assert(rows.slice(1).every((r) => r[1].startsWith('2026-01-01 00:00')));
  const one = parseCsv(
    (
      await read(
        `/reports/fine-cases.csv?${period}&employeeId=${employees[0].id}`,
      ).expect(200)
    ).text,
  );
  assert.equal(one.length, 2);
  assert.equal(one[1][8], '5000');
  const payments = parseCsv(
    (
      await read(
        '/reports/payments.csv?from=2026-03-01&to=2026-03-31&kind=REVERSAL',
      ).expect(200)
    ).text,
  );
  assert.equal(payments.length, 2);
  assert.equal(payments[1][4], '2000');
  assert.equal(payments[1][5], '-2000');
  assert.equal(payments[1][3], 'REVERSAL');
  const drafts = parseCsv(
    (
      await read(
        '/reports/fine-cases.csv?' +
          period +
          '&status=DRAFT&includeUndated=true',
      ).expect(200)
    ).text,
  );
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts[1].slice(8, 12), ['', '', '', '']);
  assert.equal(
    (
      await read(
        '/reports/fine-cases?' + period + '&status=DRAFT&includeUndated=true',
      ).expect(200)
    ).body.meta.total,
    2,
  );
  const empty = parseCsv(
    (
      await read(
        '/reports/fine-cases.csv?from=2024-01-01&to=2024-01-31',
      ).expect(200)
    ).text,
  );
  assert.equal(empty.length, 1);
  const config = app.get(ConfigService);
  config.set('CSV_MAX_ROWS', 3);
  await read('/reports/fine-cases.csv?' + period).expect(422);
  config.set('CSV_MAX_ROWS', 10000);
  config.set('CSV_MAX_DAYS', 5);
  await read('/reports/fine-cases.csv?' + period).expect(422);
  config.set('CSV_MAX_DAYS', 366);
  await read('/reports/fine-cases.csv?from=2024-01-01&to=2026-01-01').expect(
    422,
  );
  for (const endpoint of [
    '/reports/summary',
    '/reports/employee-balances',
    '/reports/fine-cases.csv',
    '/reports/payments.csv',
    '/audit-logs',
    '/settings',
  ])
    await request(http)
      .get('/api/v1' + endpoint)
      .expect(401);
  for (const query of [
    'from=2026-02-30',
    'from=2026-02-01&to=2026-01-01',
    'employeeId=invalid',
    'violationTypeId=invalid',
  ])
    await read('/reports/summary?' + query).expect(422);
  await read('/reports/employee-balances?limit=101').expect(422);
  await read('/reports/fine-cases?status=BOGUS').expect(422);
  await read('/reports/fine-cases?includeUndated=perhaps').expect(422);
  await read('/employees/' + randomUUID() + '/summary').expect(404);
  const base = await get('/settings');
  assert.equal(base.version, 0);
  assert.equal(base.currency, 'IDR');
  assert.equal(await db.appSettings.count(), 0);
  await request(http)
    .patch('/api/v1/settings')
    .set('Cookie', cookie)
    .set('Origin', process.env.APP_BASE_URL)
    .send({ businessName: 'Invalid', version: 0 })
    .expect(403);
  for (const body of [
    { businessName: 'X', version: 0 },
    { businessName: 'Valid', version: 0, currency: 'USD' },
    { businessName: null, version: 0 },
    {
      businessName: 'Valid',
      version: 0,
      finePolicyReference: 'x'.repeat(2001),
    },
  ])
    await write('patch', '/settings', body).expect(422);
  const settingService = app.get(SettingsService),
    settingAudit = settingService.audit;
  try {
    settingService.audit = async () => {
      throw new Error('Audit down');
    };
    await write('patch', '/settings', {
      businessName: 'Should rollback',
      version: 0,
    }).expect(500);
  } finally {
    settingService.audit = settingAudit;
  }
  assert.equal(await db.appSettings.count(), 0);
  const races = await Promise.all([
    write('patch', '/settings', {
      businessName: 'Usaha Satu',
      finePolicyReference: 'Kebijakan internal',
      version: 0,
    }),
    write('patch', '/settings', {
      businessName: 'Usaha Dua',
      finePolicyReference: null,
      version: 0,
    }),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  const saved = await get('/settings');
  assert.equal(saved.version, 1);
  const partial = (
    await write('patch', '/settings', {
      finePolicyReference: 'Referensi saja',
      version: saved.version,
    }).expect(200)
  ).body.data;
  assert.equal(partial.businessName, saved.businessName);
  assert.equal(partial.finePolicyReference, 'Referensi saja');
  await write('patch', '/settings', { version: partial.version }).expect(422);
  assert.equal(
    (await get('/reports/summary?' + period)).businessName,
    saved.businessName,
  );
  await write('patch', '/settings', {
    businessName: 'stale',
    version: 0,
  }).expect(409);
  const reportService = app.get(ReportsService),
    auditExport = reportService.exportAudit;
  try {
    reportService.exportAudit = async () => {
      throw new Error('Audit down');
    };
    const failed = await read('/reports/fine-cases.csv?' + period).expect(500);
    assert.match(failed.headers['content-type'], /json/);
  } finally {
    reportService.exportAudit = auditExport;
  }
  const exports = await db.auditLog.findMany({
    where: { entityType: 'ReportExport' },
  });
  assert.equal(exports.length, 5);
  assert(
    exports.every(
      (e) =>
        e.actorUserId === admin.id &&
        e.afterJson.rowCount !== undefined &&
        !JSON.stringify(e.afterJson).includes('quoted'),
    ),
  );
  const injected = await db.auditLog.create({
    data: {
      actorUserId: admin.id,
      action: 'QA_PAYLOAD',
      entityType: 'FineCase',
      entityId: c.id,
      beforeJson: {
        passwordHash: 'DUMMY_SECRET',
        sourceText: 'x'.repeat(10000),
        members: [{ employeeId: employees[0].id, token: 'DUMMY_TOKEN' }],
      },
      afterJson: { cookie: 'DUMMY_COOKIE', amount: 5000 },
    },
  });
  const audits = (
    await read(
      `/audit-logs?action=QA_PAYLOAD&actorUserId=${admin.id}&entityType=FineCase`,
    ).expect(200)
  ).body;
  assert.equal(audits.meta.total, 1);
  assert.equal(audits.data[0].id, injected.id);
  assert(!JSON.stringify(audits).includes('DUMMY_'));
  assert(JSON.stringify(audits).length < 5000);
  assert.match(audits.data[0].beforeJson.sourceText, /dipotong/);
  const ap = (await read('/audit-logs?limit=2').expect(200)).body;
  const an = (await read('/audit-logs?limit=2&page=2').expect(200)).body;
  assert(ap.meta.total > 2);
  assert(!ap.data.some((a) => an.data.some((b) => a.id === b.id)));
  const options = await get('/audit-logs/options');
  assert(options.actors.some((a) => a.id === admin.id));
  assert(options.actions.includes('SETTINGS_UPDATE'));
  assert(!JSON.stringify(options).includes('passwordHash'));
  await read('/audit-logs?actorUserId=invalid').expect(422);
  await write('delete', '/audit-logs/' + injected.id, {}).expect(404);
  // A closed case still contributes its historical cashflow, not active outstanding.
  let closed = await post(
    await create({
      occurredAt: '2026-04-01T00:00:00+07:00',
      violationTypeId: type.id,
      description: 'Closed historical case',
      members: [{ employeeId: employees[1].id, assignedAmount: 5000 }],
    }),
  );
  const pClosed = (
    await write('post', `/fine-members/${closed.members[0].id}/payments`, {
      amount: 2000,
      method: 'OTHER',
      effectiveAt: '2026-05-01T00:00:00+07:00',
    })
      .set('Idempotency-Key', randomUUID())
      .expect(201)
  ).body.data;
  await write('post', `/payments/${pClosed.id}/reverse`, {
    reason: 'Closed historical reversal',
    effectiveAt: '2026-06-01T00:00:00+07:00',
  })
    .set('Idempotency-Key', randomUUID())
    .expect(201);
  closed = await get('/fine-cases/' + closed.id);
  await write('post', `/fine-cases/${closed.id}/void`, {
    version: closed.version,
    reason: 'Kejadian ditutup setelah reversal',
  }).expect(201);
  assert.equal(
    (await get('/reports/summary?from=2026-05-01&to=2026-05-31'))
      .periodNetPaidAmount,
    '2000',
  );
  assert.equal(
    (await get('/reports/summary?from=2026-06-01&to=2026-06-30'))
      .periodNetPaidAmount,
    '-2000',
  );
  assert.equal(
    (await get('/reports/summary?from=2026-04-01&to=2026-04-30'))
      .assessedAmount,
    '0',
  );
  const voidCsv = parseCsv(
    (
      await read(
        '/reports/fine-cases.csv?from=2026-04-01&to=2026-04-30&status=VOIDED',
      ).expect(200)
    ).text,
  );
  assert.equal(voidCsv[1][8], '5000');
  assert.deepEqual(voidCsv[1].slice(9, 12), ['', '', '']);
  const sample = process.env.FINE_QA_SAMPLE_FILE
    ? JSON.parse(await readFile(process.env.FINE_QA_SAMPLE_FILE, 'utf8'))
    : {
        incidents: Array.from({ length: 18 }, (_, i) => ({
          source_text: `QA fixture ${i}`,
          raw_description: 'QA fixture',
          proposed_allocations: Array.from(
            { length: i === 0 ? 4 : i < 3 ? 2 : 1 },
            (_, j) => ({
              raw_employee_name: `QA fixture person ${j}`,
              proposed_amount_idr: i < 15 ? (i === 3 ? 10000 : 5000) : null,
            }),
          ),
        })),
      };
  const fixtureType = await db.violationType.create({
    data: {
      code: 'FIXTURE',
      name: 'Explicit QA confirmation',
      category: 'OTHER',
      defaultAmountPerPerson: 5000,
    },
  });
  const identity = new Map();
  let fixtureDrafts = 0;
  for (const incident of sample.incidents) {
    let item = await create(fixtureDraft(incident));
    if (
      incident.proposed_allocations.some((a) => a.proposed_amount_idr === null)
    ) {
      fixtureDrafts++;
      continue;
    }
    for (const a of incident.proposed_allocations)
      if (!identity.has(a.raw_employee_name))
        identity.set(
          a.raw_employee_name,
          await db.employee.create({
            data: {
              displayName: a.raw_employee_name,
              normalizedName: a.raw_employee_name.toLowerCase(),
            },
          }),
        );
    item = (
      await write('patch', '/fine-cases/' + item.id, {
        version: item.version,
        occurredAt: '2026-07-01T00:00:00+07:00',
        violationTypeId: fixtureType.id,
        members: incident.proposed_allocations.map((a) => ({
          employeeId: identity.get(a.raw_employee_name).id,
          rawEmployeeName: a.raw_employee_name,
          assignedAmount: a.proposed_amount_idr,
        })),
      }).expect(200)
    ).body.data;
    await post(item);
  }
  const fixtureSummary = await get(
    `/reports/summary?from=2026-07-01&to=2026-07-31&violationTypeId=${fixtureType.id}`,
  );
  assert.equal(fixtureSummary.caseCount, '15');
  assert.equal(fixtureSummary.allocationCount, '20');
  assert.equal(fixtureSummary.assessedAmount, '105000');
  assert.equal(fixtureSummary.cohortNetPaidAmount, '0');
  assert.equal(fixtureDrafts, 3);
  const start = performance.now();
  const serial = csv(
    ['text', 'number'],
    Array.from({ length: 10000 }, (_, i) => [
      'QA text,"Unicode é"\nnext',
      BigInt(i),
    ]),
  );
  console.log(
    `CSV local serialization:10000 rows,${Buffer.byteLength(serial)} bytes,${(performance.now() - start).toFixed(1)}ms`,
  );
  console.log(
    'PASS: report cohort/cashflow/current balances, distinct cases, per-employee filters, CSV precision/quoting/formula defence/limits/audit, read-only audit payload, settings race/rollback, WIB boundaries and18-case QA reports.',
  );
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await app.close();
}
