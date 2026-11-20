import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configure } from '../dist/http.js';
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
  console.log('INITIAL_SEED_API_PASS');
} finally {
  await app.close();
}
