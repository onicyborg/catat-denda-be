import { readFile } from 'node:fs/promises';
import { fixtureDraft } from './fixtures-fines.mjs';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import * as argon2 from 'argon2';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { FinesService } from '../dist/fines/service.js';
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
  const create = async (body = {}, key = randomUUID()) =>
    (
      await write('post', '/fine-cases', body)
        .set('Idempotency-Key', key)
        .expect(201)
    ).body.data;
  const get = async (id) =>
    (await read('/fine-cases/' + id).expect(200)).body.data;
  const employees = await Promise.all(
    Array.from({ length: 21 }, (_, i) =>
      db.employee.create({
        data: {
          displayName: 'Participant ' + i,
          normalizedName: 'participant ' + i,
        },
      }),
    ),
  );
  const type = await db.violationType.create({
    data: {
      code: 'QA',
      name: 'Kesalahan QA',
      category: 'OTHER',
      defaultAmountPerPerson: 5000,
    },
  });
  const type2 = await db.violationType.create({
    data: {
      code: 'QA2',
      name: 'Kesalahan Kedua',
      category: 'ORDER',
      defaultAmountPerPerson: 7000,
    },
  });
  const body = (amounts = [5000]) => ({
    occurredAt: '2026-01-02T00:00:00+07:00',
    violationTypeId: type.id,
    description: 'Kejadian pengujian',
    members: amounts.map((assignedAmount, i) => ({
      employeeId: employees[i].id,
      assignedAmount,
    })),
  });
  const post = async (c) =>
    (
      await write('post', `/fine-cases/${c.id}/post`, {
        version: c.version,
      }).expect(201)
    ).body.data;
  const patch = async (c, b) =>
    (
      await write('patch', `/fine-cases/${c.id}`, {
        ...b,
        version: c.version,
      }).expect((r) => {
        if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      })
    ).body.data;
  await request(http).get('/api/v1/fine-cases').expect(401);
  await write('post', '/fine-cases', {}).expect(422);
  const key = randomUUID(),
    retryBody = body([3000, 7000]);
  const retries = await Promise.all([
    create(retryBody, key),
    create(retryBody, key),
  ]);
  assert.equal(retries[0].id, retries[1].id);
  assert.equal((await create(retryBody, key.toUpperCase())).id, retries[0].id);
  assert.equal(
    await db.auditLog.count({
      where: { entityId: retries[0].id, action: 'FINE_CREATE' },
    }),
    1,
  );
  await write('post', '/fine-cases', {})
    .set('Idempotency-Key', key)
    .expect(409);
  for (const amounts of [
    [5000],
    [5000, 5000],
    [5000, 5000, 5000, 5000],
    [3000, 7000],
  ]) {
    const draft = await create(body(amounts));
    assert.equal(draft.assessedAmount, '0');
    assert.equal(draft.outstandingAmount, '0');
    assert.equal(draft.settlementStatus, null);
    const c = await post(draft);
    assert.equal(c.assessedAmount, String(amounts.reduce((a, b) => a + b, 0)));
    assert.equal(c.outstandingAmount, c.assessedAmount);
    assert.equal(c.defaultRateSnapshot, 5000);
    assert.equal(c.settlementStatus, 'UNPAID');
  }
  let historical = await post(retries[0]);
  await db.violationType.update({
    where: { id: type.id },
    data: {
      name: 'Updated',
      category: 'SPILL',
      defaultAmountPerPerson: 10000,
      isActive: false,
    },
  });
  await db.employee.update({
    where: { id: employees[0].id },
    data: { displayName: 'Updated Participant', isActive: false },
  });
  let unchanged = await get(historical.id);
  assert.equal(unchanged.violationNameSnapshot, 'Kesalahan QA');
  assert.equal(unchanged.violationCategorySnapshot, 'OTHER');
  assert.equal(
    unchanged.members.find((m) => m.employeeId === employees[0].id)
      .employeeDisplayName,
    'Participant 0',
  );
  historical = await patch(historical, { members: body([4000, 6000]).members });
  assert.equal(historical.defaultRateSnapshot, 5000);
  assert.equal(
    historical.members.find((m) => m.employeeId === employees[0].id)
      .employeeNameSnapshot,
    'Participant 0',
  );
  historical = await patch(historical, { violationTypeId: type2.id });
  assert.equal(historical.defaultRateSnapshot, 7000);
  assert.equal(historical.violationNameSnapshot, type2.name);
  await db.violationType.update({
    where: { id: type.id },
    data: { isActive: true },
  });
  await db.employee.update({
    where: { id: employees[0].id },
    data: { isActive: true },
  });
  for (const malformed of [
    { members: null },
    { members: [{ assignedAmount: 1.5 }] },
    { members: [{ assignedAmount: 0 }] },
    { members: [{ assignedAmount: 100000001 }] },
    { members: employees.map((e) => ({ employeeId: e.id })) },
    {
      members: [
        { employeeId: employees[0].id },
        { employeeId: employees[0].id },
      ],
    },
    { violationTypeId: randomUUID() },
    { members: [{ employeeId: randomUUID() }] },
    { occurredAt: '2026-02-30T12:00:00Z' },
  ])
    await write('post', '/fine-cases', malformed)
      .set('Idempotency-Key', randomUUID())
      .expect(422);
  const invalids = [
    {},
    { ...body(), occurredAt: null },
    { ...body(), occurredAt: new Date(Date.now() + 600000).toISOString() },
    { ...body(), description: 'ab' },
    { ...body(), violationTypeId: null },
    { ...body(), members: [] },
    {
      ...body(),
      members: [{ rawEmployeeName: 'Belum dikenali', assignedAmount: 5000 }],
    },
    {
      ...body(),
      members: [{ employeeId: employees[0].id, assignedAmount: null }],
    },
  ];
  for (const b of invalids) {
    const c = await create(b);
    await write('post', `/fine-cases/${c.id}/post`, {
      version: c.version,
    }).expect(422);
    assert.equal((await get(c.id)).version, c.version);
    assert.equal(
      await db.auditLog.count({
        where: { entityId: c.id, action: 'FINE_POST' },
      }),
      0,
    );
  }
  const inactive = await create(body());
  await db.employee.update({
    where: { id: employees[0].id },
    data: { isActive: false },
  });
  await write('post', `/fine-cases/${inactive.id}/post`, { version: 1 }).expect(
    422,
  );
  await db.employee.update({
    where: { id: employees[0].id },
    data: { isActive: true },
  });
  await db.violationType.update({
    where: { id: type.id },
    data: { isActive: false },
  });
  await write('post', `/fine-cases/${inactive.id}/post`, { version: 1 }).expect(
    422,
  );
  await db.violationType.update({
    where: { id: type.id },
    data: { isActive: true },
  });
  const race = await create(body());
  const results = await Promise.all([
    write('post', `/fine-cases/${race.id}/post`, { version: 1 }),
    write('post', `/fine-cases/${race.id}/post`, { version: 1 }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    await db.auditLog.count({
      where: { entityId: race.id, action: 'FINE_POST' },
    }),
    1,
  );
  const mixed = await create(body());
  const mixedResults = await Promise.all([
    write('post', `/fine-cases/${mixed.id}/post`, { version: 1 }),
    write('patch', `/fine-cases/${mixed.id}`, {
      version: 1,
      description: 'Koreksi bersamaan',
    }),
  ]);
  assert.equal(mixedResults.filter((r) => r.status === 409).length, 1);
  assert.equal(
    mixedResults.filter((r) => r.status === 200 || r.status === 201).length,
    1,
  );
  const svc = app.get(FinesService),
    audit = svc.audit;
  const rollback = await create(body());
  try {
    svc.audit = async () => {
      throw new Error('audit outage');
    };
    await write('post', `/fine-cases/${rollback.id}/post`, {
      version: 1,
    }).expect(500);
    await write('post', '/fine-cases', {})
      .set('Idempotency-Key', randomUUID())
      .expect(500);
  } finally {
    svc.audit = audit;
  }
  assert.equal((await get(rollback.id)).status, 'DRAFT');
  assert.equal((await get(rollback.id)).violationNameSnapshot, null);
  const empty = await create();
  const voided = (
    await write('post', `/fine-cases/${empty.id}/void`, {
      version: 1,
      reason: 'Draft dibatalkan',
    }).expect(201)
  ).body.data;
  assert.equal(voided.status, 'VOIDED');
  assert.equal(voided.assessedAmount, '0');
  assert.equal(voided.settlementStatus, null);
  for (const [method, action, b] of [
    ['post', '/post', { version: 2 }],
    ['patch', '', { version: 2, description: 'Ubah' }],
    ['post', '/void', { version: 2, reason: 'Batal lagi' }],
  ])
    await write(method, `/fine-cases/${empty.id}${action}`, b).expect(409);
  await write('post', `/fine-cases/${rollback.id}/void`, {
    version: 1,
    reason: 'a',
  }).expect(422);
  const member = historical.members[0];
  const payment = await db.paymentEntry.create({
    data: {
      fineCaseMemberId: member.id,
      kind: 'PAYMENT',
      amount: 1000,
      method: 'CASH',
      effectiveAt: new Date(),
      idempotencyKey: randomUUID(),
      requestHash: 'a'.repeat(64),
      recordedBy: admin.id,
    },
  });
  let paid = await get(historical.id);
  assert.equal(paid.netPaidAmount, '1000');
  assert.equal(paid.outstandingAmount, '9000');
  assert.equal(paid.settlementStatus, 'PARTIAL');
  assert.equal(paid.canVoid, false);
  await write('post', `/fine-cases/${paid.id}/void`, {
    version: paid.version,
    reason: 'Tidak diizinkan',
  }).expect(409);
  await write('patch', `/fine-cases/${paid.id}`, {
    version: paid.version,
    members: body().members,
  }).expect(409);
  paid = await patch(paid, { description: 'Catatan setelah pembayaran' });
  await db.paymentEntry.create({
    data: {
      fineCaseMemberId: member.id,
      kind: 'REVERSAL',
      amount: 1000,
      originalPaymentId: payment.id,
      effectiveAt: new Date(),
      idempotencyKey: randomUUID(),
      requestHash: 'b'.repeat(64),
      recordedBy: admin.id,
    },
  });
  paid = await get(paid.id);
  assert.equal(paid.netPaidAmount, '0');
  assert.equal(paid.hasLedgerHistory, true);
  assert.equal(paid.canEditFinancial, false);
  await write('patch', `/fine-cases/${paid.id}`, {
    version: paid.version,
    occurredAt: new Date().toISOString(),
  }).expect(409);
  const cancelled = (
    await write('post', `/fine-cases/${paid.id}/void`, {
      version: paid.version,
      reason: 'Pembayaran sudah dibalik',
    }).expect(201)
  ).body.data;
  assert.equal(cancelled.members[0].entries.length, 2);
  assert.equal(cancelled.outstandingAmount, '0');
  const dated = await create({
    ...body(),
    occurredAt: '2026-01-01T17:00:00Z',
    description: 'WIB boundary needle',
  });
  const filtered = await read(
    '/fine-cases?from=2026-01-02&to=2026-01-02&q=boundary&employeeId=' +
      employees[0].id,
  ).expect(200);
  assert.equal(filtered.body.meta.total, 1);
  assert.equal(filtered.body.data[0].id, dated.id);
  assert.equal(
    (
      await read('/fine-cases?from=2026-01-01&to=2026-01-01&q=boundary').expect(
        200,
      )
    ).body.meta.total,
    0,
  );
  await read('/fine-cases?from=2026-02-02&to=2026-01-01').expect(422);
  const page1 = (await read('/fine-cases?limit=2').expect(200)).body;
  const page2 = (await read('/fine-cases?limit=2&page=2').expect(200)).body;
  assert(page1.meta.total > 2);
  assert(!page1.data.some((a) => page2.data.some((b) => a.id === b.id)));
  await read('/fine-cases/' + randomUUID()).expect(404);
  // Explicit QA confirmations below are test inputs, not a production migration or inferred identity mapping.
  const sample = process.env.FINE_QA_SAMPLE_FILE
    ? JSON.parse(await readFile(process.env.FINE_QA_SAMPLE_FILE, 'utf8'))
    : {
        incidents: Array.from({ length: 18 }, (_, i) => ({
          fixture_id: `QA-${i}`,
          source_text: `QA source ${i}`,
          raw_description: 'QA source incident',
          proposed_allocations: Array.from(
            { length: i < 6 ? 2 : 1 },
            (_, j) => ({
              raw_employee_name: `QA person ${j}`,
              proposed_amount_idr: i < 15 ? 5000 : null,
            }),
          ),
        })),
      };
  const fixtureCases = [];
  const identity = new Map();
  for (const incident of sample.incidents) {
    const draft = await create(fixtureDraft(incident));
    assert.equal(draft.occurredAt, null);
    assert.equal(draft.violationTypeId, null);
    assert(draft.members.every((m) => m.employeeId === null));
    assert.equal(draft.assessedAmount, '0');
    fixtureCases.push(draft);
    for (const allocation of incident.proposed_allocations)
      if (!identity.has(allocation.raw_employee_name))
        identity.set(
          allocation.raw_employee_name,
          await db.employee.create({
            data: {
              displayName: allocation.raw_employee_name,
              normalizedName: allocation.raw_employee_name.toLowerCase(),
            },
          }),
        );
  }
  assert.equal(fixtureCases.length, 18);
  for (let i = 0; i < sample.incidents.length; i++) {
    const incident = sample.incidents[i];
    if (
      incident.proposed_allocations.some((a) => a.proposed_amount_idr === null)
    )
      continue;
    let c = await patch(fixtureCases[i], {
      occurredAt: '2026-01-02T00:00:00+07:00',
      violationTypeId: type.id,
      members: incident.proposed_allocations.map((a) => ({
        employeeId: identity.get(a.raw_employee_name).id,
        rawEmployeeName: a.raw_employee_name,
        assignedAmount: a.proposed_amount_idr,
      })),
    });
    fixtureCases[i] = await post(c);
  }
  assert.equal(fixtureCases.filter((c) => c.status === 'POSTED').length, 15);
  assert.equal(fixtureCases.filter((c) => c.status === 'DRAFT').length, 3);
  assert.equal(
    fixtureCases.reduce((sum, c) => sum + BigInt(c.assessedAmount), 0n),
    105000n,
  );
  for (const pair of [
    ['El', 'Elvina'],
    ['Davin', 'Dhafin'],
  ])
    if (pair.every((name) => identity.has(name)))
      assert.notEqual(identity.get(pair[0]).id, identity.get(pair[1]).id);
  const sample011 = sample.incidents.findIndex(
    (i) => i.fixture_id === 'SAMPLE-011',
  );
  if (sample011 >= 0) {
    assert(fixtureCases[sample011].description.includes('2000'));
    assert.equal(fixtureCases[sample011].assessedAmount, '5000');
  }
  console.log(
    'PASS: fine lifecycle, per-person totals, idempotency, snapshots/corrections, posting validation, concurrency, audit rollback, WIB filters, synthetic ledger guards and 18-record QA fixture.',
  );
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await app.close();
}
