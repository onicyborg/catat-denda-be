import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import * as argon2 from 'argon2';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { PaymentsService } from '../dist/payments/service.js';
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
  const employee = await db.employee.create({
    data: { displayName: 'Ledger Person', normalizedName: 'ledger person' },
  });
  const type = await db.violationType.create({
    data: {
      code: 'LEDGER',
      name: 'Ledger QA',
      category: 'OTHER',
      defaultAmountPerPerson: 5000,
    },
  });
  const createCase = async (posted = true) => {
    const draft = (
      await write('post', '/fine-cases', {
        occurredAt: '2026-01-01T01:00:00Z',
        violationTypeId: type.id,
        description: 'Kejadian ledger QA',
        members: [{ employeeId: employee.id, assignedAmount: 5000 }],
      })
        .set('Idempotency-Key', randomUUID())
        .expect(201)
    ).body.data;
    return posted
      ? (
          await write('post', `/fine-cases/${draft.id}/post`, {
            version: 1,
          }).expect(201)
        ).body.data
      : draft;
  };
  const detail = async (id) =>
    (await read('/fine-cases/' + id).expect(200)).body.data;
  const data = {
    amount: 2000,
    method: 'CASH',
    effectiveAt: '2026-01-02T01:00:00Z',
  };
  const pay = (member, body = data, key = randomUUID()) =>
    write('post', `/fine-members/${member}/payments`, body).set(
      'Idempotency-Key',
      key,
    );
  const reverse = (
    id,
    body = {
      reason: 'Salah pencatatan pembayaran',
      effectiveAt: '2026-01-03T01:00:00Z',
    },
    key = randomUUID(),
  ) =>
    write('post', `/payments/${id}/reverse`, body).set('Idempotency-Key', key);
  await request(http).get('/api/v1/payments').expect(401);
  let c = await createCase();
  const member = c.members[0].id;
  await request(http)
    .post(`/api/v1/fine-members/${member}/payments`)
    .set('Cookie', cookie)
    .set('Origin', process.env.APP_BASE_URL)
    .set('Idempotency-Key', randomUUID())
    .send(data)
    .expect(403);
  await write('post', `/fine-members/${member}/payments`, data).expect(422);
  for (const value of [0, -1, 1.5, 100000001, '2000', null])
    await pay(member, { ...data, amount: value }).expect(422);
  for (const body of [
    { ...data, method: 'CARD' },
    { ...data, effectiveAt: null },
    { ...data, effectiveAt: '2026-02-30T10:00:00Z' },
    { ...data, effectiveAt: '2026-01-02T10:00:00' },
    { ...data, effectiveAt: new Date(Date.now() + 600000).toISOString() },
    { ...data, note: 'x'.repeat(1001) },
    { ...data, recordedBy: admin.id },
  ])
    await pay(member, body).expect(422);
  const firstKey = randomUUID(),
    first = (await pay(member, data, firstKey).expect(201)).body.data;
  assert.equal(first.amount, 2000);
  assert.equal(first.recordedBy, admin.id);
  assert.equal(first.recordedByName, 'master.qa');
  assert.equal(first.signedAmount, '2000');
  assert.equal(first.canReverse, true);
  assert(!JSON.stringify(first).includes('requestHash'));
  assert(!JSON.stringify(first).includes(firstKey));
  let snapshot = await detail(c.id);
  assert.equal(snapshot.netPaidAmount, '2000');
  assert.equal(snapshot.outstandingAmount, '3000');
  assert.equal(snapshot.settlementStatus, 'PARTIAL');
  assert.equal(snapshot.members[0].settlementStatus, 'PARTIAL');
  assert.equal(snapshot.version, c.version + 1);
  await pay(member, { ...data, amount: 4000 }).expect(422);
  assert.equal(await db.paymentEntry.count(), 1);
  assert.equal(
    (
      await pay(
        member,
        {
          note: '',
          effectiveAt: '2026-01-02T08:00:00+07:00',
          method: 'CASH',
          amount: 2000,
        },
        firstKey.toUpperCase(),
      ).expect(201)
    ).body.data.id,
    first.id,
  );
  await pay(member, { ...data, amount: 1000 }, firstKey).expect(409);
  const other = await createCase();
  await pay(other.members[0].id, data, firstKey).expect(409);
  await reverse(first.id, undefined, firstKey).expect(409);
  const otherAdmin = await db.user.create({
    data: { username: 'other.qa', passwordHash: await argon2.hash(password) },
  });
  const otherLogin = await request(http)
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_BASE_URL)
    .send({ username: otherAdmin.username, password })
    .expect(201);
  await request(http)
    .post(`/api/v1/fine-members/${member}/payments`)
    .set('Cookie', otherLogin.headers['set-cookie'][0].split(';')[0])
    .set('Origin', process.env.APP_BASE_URL)
    .set('X-CSRF-Token', otherLogin.body.data.csrfToken)
    .set('Idempotency-Key', firstKey)
    .send(data)
    .expect(409);
  const last = (
    await pay(member, {
      ...data,
      amount: 3000,
      method: 'TRANSFER',
      effectiveAt: '2026-01-03T01:00:00Z',
    }).expect(201)
  ).body.data;
  snapshot = await detail(c.id);
  assert.equal(snapshot.outstandingAmount, '0');
  assert.equal(snapshot.settlementStatus, 'PAID');
  assert.equal(snapshot.members[0].settlementStatus, 'PAID');
  await pay(member, { ...data, amount: 1 }).expect(422);
  await write('post', `/fine-cases/${c.id}/void`, {
    version: snapshot.version,
    reason: 'Masih ada pembayaran',
  }).expect(409);
  for (const body of [
    { reason: 'abc', effectiveAt: '2026-01-03T01:00:00Z' },
    { reason: 'Reason valid', effectiveAt: '2026-01-01T01:00:00Z' },
    {
      reason: 'Reason valid',
      effectiveAt: new Date(Date.now() + 1000).toISOString(),
    },
    {
      reason: 'Reason valid',
      effectiveAt: '2026-01-03T01:00:00Z',
      amount: 1000,
    },
  ])
    await reverse(first.id, body).expect(422);
  const reverseKey = randomUUID(),
    revBody = {
      reason: ' Pembayaran salah dicatat ',
      effectiveAt: '2026-01-04T01:00:00Z',
    };
  const reversed = (await reverse(first.id, revBody, reverseKey).expect(201))
    .body.data;
  assert.equal(reversed.amount, 2000);
  assert.equal(reversed.signedAmount, '-2000');
  assert.equal(reversed.originalPaymentId, first.id);
  assert.equal(reversed.method, null);
  assert.equal(reversed.memberId, member);
  assert.equal(
    (
      await reverse(
        first.id,
        { ...revBody, reason: revBody.reason.trim() },
        reverseKey,
      ).expect(201)
    ).body.data.id,
    reversed.id,
  );
  await reverse(first.id).expect(409);
  await reverse(reversed.id).expect(409);
  assert.equal(
    (await read('/payments/' + first.id).expect(200)).body.data.reversalId,
    reversed.id,
  );
  snapshot = await detail(c.id);
  assert.equal(snapshot.netPaidAmount, '3000');
  assert.equal(snapshot.outstandingAmount, '2000');
  assert.equal(snapshot.members[0].entries.length, 3);
  await reverse(last.id).expect(201);
  snapshot = await detail(c.id);
  assert.equal(snapshot.netPaidAmount, '0');
  assert.equal(snapshot.canEditFinancial, false);
  await write('patch', `/fine-cases/${c.id}`, {
    version: snapshot.version,
    members: [{ employeeId: employee.id, assignedAmount: 3000 }],
  }).expect(409);
  await write('post', `/fine-cases/${c.id}/void`, {
    version: snapshot.version,
    reason: 'Pembayaran telah dibalik',
  }).expect(201);
  assert.equal(
    (await pay(member, data, firstKey).expect(201)).body.data.id,
    first.id,
  );
  await pay(member).expect(409);
  await reverse(first.id).expect(409);
  const draft = await createCase(false);
  await pay(draft.members[0].id).expect(409);
  const archived = await createCase();
  await db.employee.update({
    where: { id: employee.id },
    data: { isActive: false },
  });
  await pay(archived.members[0].id).expect(201);
  await db.employee.update({
    where: { id: employee.id },
    data: { isActive: true },
  });
  const concurrent = await createCase();
  const race = await Promise.all([
    pay(concurrent.members[0].id, { ...data, amount: 4000 }),
    pay(concurrent.members[0].id, { ...data, amount: 4000 }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 422]);
  assert.equal((await detail(concurrent.id)).netPaidAmount, '4000');
  const same = await createCase(),
    sameKey = randomUUID();
  const sameRace = await Promise.all([
    pay(same.members[0].id, data, sameKey),
    pay(same.members[0].id, data, sameKey),
  ]);
  assert(sameRace.every((r) => r.status === 201));
  assert.equal(sameRace[0].body.data.id, sameRace[1].body.data.id);
  assert.equal(
    await db.auditLog.count({ where: { entityId: sameRace[0].body.data.id } }),
    1,
  );
  const reverseRace = await Promise.all([
    reverse(sameRace[0].body.data.id),
    reverse(sameRace[0].body.data.id),
  ]);
  assert.deepEqual(reverseRace.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await detail(same.id)).netPaidAmount, '0');
  for (let i = 0; i < 3; i++) {
    const target = await createCase();
    const voidRace = await Promise.all([
      pay(target.members[0].id),
      write('post', `/fine-cases/${target.id}/void`, {
        version: target.version,
        reason: 'Batal bersamaan pembayaran',
      }),
    ]);
    assert.deepEqual(voidRace.map((r) => r.status).sort(), [201, 409]);
    const final = await detail(target.id);
    assert(
      final.status === 'VOIDED'
        ? final.members[0].entries.length === 0
        : final.netPaidAmount === '2000',
    );
    const correction = await createCase();
    const editRace = await Promise.all([
      pay(correction.members[0].id, { ...data, amount: 4000 }),
      write('patch', `/fine-cases/${correction.id}`, {
        version: correction.version,
        members: [{ employeeId: employee.id, assignedAmount: 3000 }],
      }),
    ]);
    assert(
      (editRace[0].status === 201 && editRace[1].status === 409) ||
        (editRace[0].status === 422 && editRace[1].status === 200),
    );
    const changed = await detail(correction.id);
    assert(BigInt(changed.netPaidAmount) <= BigInt(changed.assessedAmount));
  }
  const service = app.get(PaymentsService),
    audit = service.audit;
  const rollback = await createCase();
  const count = await db.paymentEntry.count();
  try {
    service.audit = async () => {
      throw new Error('Synthetic audit outage');
    };
    await pay(rollback.members[0].id).expect(500);
    await reverse(race.find((r) => r.status === 201).body.data.id).expect(500);
  } finally {
    service.audit = audit;
  }
  assert.equal(await db.paymentEntry.count(), count);
  assert.equal((await detail(rollback.id)).version, rollback.version);
  // Real lock contention must exhaust bounded retries without inserting a ledger row.
  let release;
  let ready;
  const acquired = new Promise((resolve) => {
    ready = resolve;
  });
  const held = db.$transaction(
    async (tx) => {
      await db.lockRow(tx, 'FineCase', rollback.id);
      ready();
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    { timeout: 15000 },
  );
  await acquired;
  try {
    const busy = await pay(rollback.members[0].id).expect(409);
    assert.equal(busy.body.error.details.retryable, true);
    assert.equal(
      await db.paymentEntry.count({
        where: { fineCaseMemberId: rollback.members[0].id },
      }),
      0,
    );
  } finally {
    release();
    await held;
  }
  const dateCase = await createCase();
  const atBoundary = (
    await pay(dateCase.members[0].id, {
      ...data,
      effectiveAt: '2026-02-01T00:00:00+07:00',
    }).expect(201)
  ).body.data;
  const filtered = (
    await read(
      `/payments?from=2026-02-01&to=2026-02-01&employeeId=${employee.id}&caseId=${dateCase.id}&kind=PAYMENT`,
    ).expect(200)
  ).body;
  assert.equal(filtered.meta.total, 1);
  assert.equal(filtered.data[0].id, atBoundary.id);
  assert.equal(
    (
      await read(
        `/payments?from=2026-01-31&to=2026-01-31&caseId=${dateCase.id}`,
      ).expect(200)
    ).body.meta.total,
    0,
  );
  const page = (await read('/payments?limit=2').expect(200)).body,
    next = (await read('/payments?limit=2&page=2').expect(200)).body;
  assert(page.meta.total > 2);
  assert(!page.data.some((a) => next.data.some((b) => a.id === b.id)));
  for (const q of [
    'limit=101',
    'page=0',
    'kind=INVALID',
    'employeeId=oops',
    'from=2026-02-02&to=2026-01-01',
  ])
    await read('/payments?' + q).expect(422);
  await read('/payments/' + randomUUID()).expect(404);
  await pay(randomUUID()).expect(404);
  await reverse(randomUUID()).expect(404);
  await write('patch', '/payments/' + first.id, { amount: 1 }).expect(404);
  await write('delete', '/payments/' + first.id, {}).expect(404);
  const secondEmployee = await db.employee.create({
    data: {
      displayName: 'Second ledger person',
      normalizedName: 'second ledger person',
    },
  });
  let multi = (
    await write('post', '/fine-cases', {
      occurredAt: '2026-01-01T01:00:00Z',
      violationTypeId: type.id,
      description: 'Multi employee balances',
      members: [
        { employeeId: employee.id, assignedAmount: 5000 },
        { employeeId: secondEmployee.id, assignedAmount: 7000 },
      ],
    })
      .set('Idempotency-Key', randomUUID())
      .expect(201)
  ).body.data;
  multi = (
    await write('post', `/fine-cases/${multi.id}/post`, { version: 1 }).expect(
      201,
    )
  ).body.data;
  await pay(multi.members.find((m) => m.employeeId === employee.id).id).expect(
    201,
  );
  await pay(multi.members.find((m) => m.employeeId === secondEmployee.id).id, {
    ...data,
    amount: 7000,
  }).expect(201);
  const combined = await detail(multi.id);
  assert.equal(combined.assessedAmount, '12000');
  assert.equal(combined.netPaidAmount, '9000');
  assert.equal(combined.outstandingAmount, '3000');
  assert.equal(combined.settlementStatus, 'PARTIAL');
  assert.equal(
    combined.members.find((m) => m.employeeId === secondEmployee.id)
      .settlementStatus,
    'PAID',
  );
  const active = await db.fineCaseMember.findMany({
    where: { employeeId: employee.id, fineCase: { status: 'POSTED' } },
    include: { entries: true },
  });
  let assessed = 0n,
    net = 0n;
  for (const m of active) {
    assessed += BigInt(m.assignedAmount);
    net += m.entries.reduce(
      (sum, e) => sum + (e.kind === 'PAYMENT' ? 1n : -1n) * BigInt(e.amount),
      0n,
    );
  }
  assert(net >= 0n && net <= assessed);
  const caseIds = [...new Set(active.map((m) => m.fineCaseId))];
  let apiNet = 0n;
  for (const id of caseIds)
    apiNet += (await detail(id)).members
      .filter((m) => m.employeeId === employee.id)
      .reduce((sum, m) => sum + BigInt(m.netPaidAmount), 0n);
  assert.equal(net, apiNet);
  const audits = await db.auditLog.findMany({
    where: { entityType: 'PaymentEntry' },
  });
  assert.equal(audits.length, await db.paymentEntry.count());
  assert(audits.every((a) => a.actorUserId === admin.id && a.requestId));
  console.log(
    'PASS: partial/full payments, immutable ledger, actor/CSRF/validation, canonical idempotency, replay across lifecycle, reversal, races, bounded DB lock retries, audit rollback, effectiveAt WIB filters, paging and member/case/employee consistency.',
  );
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await app.close();
}
