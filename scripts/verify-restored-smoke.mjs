import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { configure } from '../dist/http.js';
const { AppModule } = await import('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false });
configure(app);
await app.init();
try {
  const http = app.getHttpServer(),
    login = await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', process.env.APP_BASE_URL)
      .send({
        username: 'recovery.admin',
        password: process.env.QA_ADMIN_PASSWORD,
      })
      .expect(201),
    cookie = login.headers['set-cookie'][0].split(';')[0];
  const get = async (path) =>
    (
      await request(http)
        .get('/api/v1' + path)
        .set('Cookie', cookie)
        .expect(200)
    ).body.data;
  const fine = await get('/fine-cases/' + process.env.QA_FINE_ID);
  assert.equal(fine.assessedAmount, '5000');
  assert.equal(fine.netPaidAmount, '2000');
  assert.equal(fine.members[0].entries.length, 1);
  const report = await get('/reports/summary?from=2026-01-01&to=2026-01-31');
  assert.equal(report.currentOutstandingAmount, '3000');
  const ledger = await get('/payments?from=2026-01-01&to=2026-01-31');
  assert.equal(ledger.length, 1);
  await request(http)
    .get('/api/v1/health/ready')
    .set('Cookie', cookie)
    .expect(200);
  if (process.env.QA_VERIFY_WRITES === 'true') {
    const post = (path, data) =>
      request(http)
        .post('/api/v1' + path)
        .set('Cookie', cookie)
        .set('Origin', process.env.APP_BASE_URL)
        .set('X-CSRF-Token', login.body.data.csrfToken)
        .set('Idempotency-Key', crypto.randomUUID())
        .send(data);
    const payment = (
      await post(`/fine-members/${fine.members[0].id}/payments`, {
        amount: 1000,
        method: 'CASH',
        effectiveAt: '2026-01-03T00:00:00+07:00',
      }).expect(201)
    ).body.data;
    await post(`/payments/${payment.id}/reverse`, {
      reason: 'Isolated runtime privilege verification',
      effectiveAt: '2026-01-04T00:00:00+07:00',
    }).expect(201);
    assert.equal(
      (await get('/reports/summary?from=2026-01-01&to=2026-01-31'))
        .currentOutstandingAmount,
      '3000',
    );
    await post('/auth/change-password', {
      currentPassword: process.env.QA_ADMIN_PASSWORD,
      newPassword: crypto.randomUUID() + '-Q1!',
    }).expect(201);
  }
  console.log('RESTORED_SMOKE_PASS');
} finally {
  await app.close();
}
