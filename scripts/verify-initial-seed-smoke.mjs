import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configure } from '../dist/http.js';
import { v7 as uuidv7 } from 'uuid';
const app = await NestFactory.create(AppModule, {
  logger: false,
  abortOnError: false,
});
configure(app);
await app.init();
try {
  const server = app.getHttpServer();
  const login = await request(server)
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_BASE_URL)
    .send({ username: 'defyana', password: process.env.QA_ADMIN_PASSWORD })
    .expect(201);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const activeTypes = await request(server)
    .get('/api/v1/violation-types')
    .set('Cookie', cookie)
    .expect(200);
  const allTypes = await request(server)
    .get('/api/v1/violation-types?status=ALL')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(activeTypes.body.data.length, 4);
  assert.equal(allTypes.body.data.length, 6);
  assert(
    allTypes.body.data
      .filter((type) =>
        ['SALAH-PESANAN', 'PERLU-KLASIFIKASI'].includes(type.code),
      )
      .every((type) => type.isActive === false),
  );
  assert.match(login.headers['x-request-id'], /^[0-9a-f-]{14}7[0-9a-f-]{21}$/);
  await request(server)
    .get('/api/v1/fine-cases/' + process.env.QA_FINE_ID)
    .set('Cookie', cookie)
    .expect(200);
  const dashboard = await request(server)
    .get('/api/v1/dashboard/summary')
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(dashboard.body.data.draftCount, '18');
  assert.equal(dashboard.body.data.summary.currentOutstandingAmount, '0');
  await request(server)
    .patch('/api/v1/fine-cases/' + process.env.QA_FINE_ID)
    .set('Origin', process.env.APP_BASE_URL)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', login.body.data.csrfToken)
    .send({ version: 2, description: 'API review of seeded draft' })
    .expect(200);
  const post = async (path, data) =>
    (
      await request(server)
        .post('/api/v1' + path)
        .set('Origin', process.env.APP_BASE_URL)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', login.body.data.csrfToken)
        .set('Idempotency-Key', uuidv7())
        .send(data)
        .expect(201)
    ).body.data;
  const type = await post('/violation-types', {
    code: 'UUID7',
    name: 'UUIDv7 QA',
    category: 'OTHER',
    defaultAmountPerPerson: 5000,
  });
  await request(server)
    .patch('/api/v1/fine-cases/' + process.env.QA_FINE_ID)
    .set('Origin', process.env.APP_BASE_URL)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', login.body.data.csrfToken)
    .send({
      version: 3,
      occurredAt: '2026-01-01T00:00:00+07:00',
      violationTypeId: type.id,
    })
    .expect(200);
  const fine = await post('/fine-cases/' + process.env.QA_FINE_ID + '/post', {
    version: 4,
  });
  await post('/employees/' + fine.members[0].employeeId + '/aliases', {
    aliasDisplay: 'UUIDv7 alias',
  });
  const payment = await post(
    '/fine-members/' + fine.members[0].id + '/payments',
    { amount: 2000, method: 'CASH', effectiveAt: '2026-01-01T00:00:00+07:00' },
  );
  await post('/payments/' + payment.id + '/reverse', {
    reason: 'UUIDv7 verification',
    effectiveAt: '2026-01-02T00:00:00+07:00',
  });
  await request(server)
    .get('/api/v1/reports/fine-cases.csv?from=2026-01-01&to=2026-01-31')
    .set('Cookie', cookie)
    .expect(200);
  console.log('INITIAL_SEED_API_PASS');
} finally {
  await app.close();
}
