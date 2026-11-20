import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import * as argon2 from 'argon2';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { MasterRepository } from '../dist/master/repository.js';
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
  await request(http)
    .post('/api/v1/employees')
    .set('Cookie', cookie)
    .set('Origin', process.env.APP_BASE_URL)
    .send({ displayName: 'Blocked' })
    .expect(403);
  assert.equal(await db.employee.count(), 0);
  const create = async (displayName, employeeCode) =>
    (
      await write('post', '/employees', { displayName, employeeCode }).expect(
        201,
      )
    ).body.data;
  const el = await create('  El  ', ' e01 '),
    elvina = await create('Elvina', 'E02'),
    davin = await create('Davin'),
    dhafin = await create('Dhafin'),
    duplicate = await create('El', 'E03');
  assert.equal(el.employeeCode, 'E01');
  assert.equal(el.displayName, 'El');
  assert.notEqual(el.id, duplicate.id);
  assert.notEqual(davin.id, dhafin.id);
  await write('post', '/employees', {
    displayName: 'Duplicate code',
    employeeCode: 'e01',
  }).expect(409);
  for (const body of [
    { displayName: null },
    { displayName: 'X' },
    { displayName: 'Valid', isActive: false },
  ])
    await write('post', '/employees', body).expect(422);
  await write('patch', '/employees/' + el.id, { displayName: null }).expect(
    422,
  );
  const alias = (
    await write('post', `/employees/${el.id}/aliases`, {
      aliasDisplay: '  Elo   Bar  ',
    }).expect(201)
  ).body.data;
  const search = await read('/employees?q=ELO%20%20BAR').expect(200);
  assert.equal(search.body.meta.total, 1);
  assert.equal(search.body.data[0].id, el.id);
  for (const aliasDisplay of ['Elvina', 'el'])
    await write('post', `/employees/${el.id}/aliases`, { aliasDisplay }).expect(
      409,
    );
  await write('post', '/employees', { displayName: 'ELO BAR' }).expect(409);
  await write('patch', '/employees/' + davin.id, {
    displayName: 'elo bar',
  }).expect(409);
  assert.equal(
    (await read('/employees/' + davin.id).expect(200)).body.data.displayName,
    'Davin',
  );
  await write('delete', `/employees/${elvina.id}/aliases/${alias.id}`).expect(
    404,
  );
  await write('delete', `/employees/${el.id}/aliases/${alias.id}`).expect(200);
  const races = await Promise.all([
    write('post', `/employees/${el.id}/aliases`, {
      aliasDisplay: 'Shared Alias',
    }),
    write('post', `/employees/${elvina.id}/aliases`, {
      aliasDisplay: '  SHARED   alias  ',
    }),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [201, 409]);
  const nameRace = await Promise.all([
    write('post', '/employees', { displayName: 'Reserved Identity' }),
    write('post', `/employees/${elvina.id}/aliases`, {
      aliasDisplay: 'reserved identity',
    }),
  ]);
  assert.deepEqual(nameRace.map((r) => r.status).sort(), [201, 409]);
  const page = await read('/employees?status=ALL&limit=2&page=1').expect(200);
  assert.equal(page.body.data.length, 2);
  assert(page.body.meta.total >= 5);
  const next = await read('/employees?status=ALL&limit=2&page=2').expect(200);
  assert(
    !next.body.data.some((e) => page.body.data.some((p) => p.id === e.id)),
  );
  for (const query of ['limit=101', 'page=0', 'status=BOGUS', 'limit=2.5'])
    await read('/employees?' + query).expect(422);
  await read('/employees/not-uuid').expect(400);
  await read('/employees/' + randomUUID()).expect(404);
  const typeBody = {
    code: 'other',
    name: 'Lainnya',
    category: 'OTHER',
    defaultAmountPerPerson: 5000,
    description: 'Nominal ditetapkan admin.',
  };
  const type = (await write('post', '/violation-types', typeBody).expect(201))
    .body.data;
  assert.equal(type.code, 'OTHER');
  await write('post', '/violation-types', typeBody).expect(409);
  for (const amount of [null, 0, -1, 1.5, 100000001, '5000'])
    await write('post', '/violation-types', {
      ...typeBody,
      code: 'BAD',
      defaultAmountPerPerson: amount,
    }).expect(422);
  for (const body of [
    { ...typeBody, code: '??' },
    { ...typeBody, category: 'CUSTOM' },
  ])
    await write('post', '/violation-types', body).expect(422);
  await write('patch', '/violation-types/' + type.id, { name: null }).expect(
    422,
  );
  // Historical references are synthetic; Phase 3 will test the actual posting workflow.
  const fine = await db.fineCase.create({
    data: {
      createdBy: admin.id,
      status: 'POSTED',
      occurredAt: new Date(),
      violationTypeId: type.id,
      violationCodeSnapshot: type.code,
      violationNameSnapshot: type.name,
      violationCategorySnapshot: type.category,
      defaultRateSnapshot: 5000,
      description: 'Synthetic historic reference.',
      members: {
        create: {
          employeeId: el.id,
          employeeNameSnapshot: 'El',
          assignedAmount: 5000,
        },
      },
    },
  });
  await write('patch', '/employees/' + el.id, {
    displayName: 'El Updated',
    employeeCode: null,
  }).expect(200);
  await write('patch', '/violation-types/' + type.id, {
    name: 'Lainnya Updated',
    defaultAmountPerPerson: 10000,
  }).expect(200);
  await write('post', '/employees/' + el.id + '/archive', {}).expect(201);
  await write('post', '/violation-types/' + type.id + '/archive', {}).expect(
    201,
  );
  assert.equal(
    (await read('/employees?q=El%20Updated').expect(200)).body.meta.total,
    0,
  );
  assert.equal(
    (await read('/employees?q=El%20Updated&status=INACTIVE').expect(200)).body
      .meta.total,
    1,
  );
  assert.equal(
    (await read('/violation-types?category=OTHER').expect(200)).body.meta.total,
    0,
  );
  assert.equal(
    (
      await read(
        '/violation-types?category=OTHER&status=INACTIVE&q=Updated',
      ).expect(200)
    ).body.meta.total,
    1,
  );
  const updates = await Promise.all([
    write('patch', '/violation-types/' + type.id, {
      defaultAmountPerPerson: 11000,
    }),
    write('patch', '/violation-types/' + type.id, {
      defaultAmountPerPerson: 12000,
    }),
  ]);
  assert(updates.every((response) => response.status === 200));
  const edits = await db.auditLog.findMany({
    where: { entityId: type.id, action: 'VIOLATION_TYPE_UPDATE' },
  });
  const first = edits.find(
    (e) => e.beforeJson.defaultAmountPerPerson === 10000,
  );
  assert(first);
  assert(
    edits.some(
      (e) =>
        e.beforeJson.defaultAmountPerPerson ===
        first.afterJson.defaultAmountPerPerson,
    ),
  );
  const history = await db.fineCase.findUniqueOrThrow({
    where: { id: fine.id },
    include: { members: true },
  });
  assert.equal(history.violationNameSnapshot, 'Lainnya');
  assert.equal(history.defaultRateSnapshot, 5000);
  assert.equal(history.members[0].employeeNameSnapshot, 'El');
  await write('post', '/employees/' + el.id + '/restore', {}).expect(201);
  await write('post', '/violation-types/' + type.id + '/restore', {}).expect(
    201,
  );
  assert.equal(
    (await read('/employees/' + el.id).expect(200)).body.data.archivedAt,
    null,
  );
  await write('delete', '/employees/' + el.id).expect(404);
  await write('delete', '/violation-types/' + type.id).expect(404);
  const repo = app.get(MasterRepository),
    audit = repo.audit;
  try {
    repo.audit = async () => {
      throw new Error('Simulated audit outage');
    };
    await write('post', '/employees', { displayName: 'Rollback Test' }).expect(
      500,
    );
  } finally {
    repo.audit = audit;
  }
  assert.equal(
    await db.employee.count({ where: { displayName: 'Rollback Test' } }),
    0,
  );
  const audits = await db.auditLog.findMany({
    where: {
      entityType: { in: ['Employee', 'EmployeeAlias', 'ViolationType'] },
    },
  });
  assert(
    audits.some(
      (a) =>
        a.action === 'EMPLOYEE_UPDATE' &&
        a.beforeJson.displayName === 'El' &&
        a.afterJson.displayName === 'El Updated',
    ),
  );
  assert(audits.some((a) => a.action === 'ALIAS_REMOVE'));
  assert(audits.every((a) => a.actorUserId === admin.id && a.requestId));
  assert(!JSON.stringify(audits).includes(password));
  console.log(
    'PASS: master CRUD/archive/restore, filters/pagination, alias/name races, validation, history retention, audit rollback and private API.',
  );
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await app.close();
}
