import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import * as argon2 from 'argon2';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
const schema = 'qa_' + randomBytes(6).toString('hex');
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.APP_BASE_URL = 'http://localhost:3000';
execFileSync('pnpm', ['prisma:deploy'], { stdio: 'pipe', env: process.env });
const { AppModule } = await import('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false });
configure(app);
await app.init();
const db = app.get(PrismaService),
  http = app.getHttpServer();
const failures = [];
async function check(name, test) {
  try {
    await test();
    console.log('PASS:', name);
  } catch (error) {
    failures.push(name);
    console.error('FAIL:', name, error.message);
  }
}
try {
  const email = 'regression@example.test',
    password = randomBytes(20).toString('hex');
  await db.user.create({
    data: { email, passwordHash: await argon2.hash(password) },
  });
  const login = await request(http)
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_BASE_URL)
    .send({ email, password })
    .expect(201);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  await db.user.create({
    data: { username: 'qa.admin', passwordHash: await argon2.hash(password) },
  });
  await check('username-only admin and normalized username login', async () => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .set('Origin', process.env.APP_BASE_URL)
      .send({ username: ' QA.ADMIN ', password })
      .expect(201);
    assert.equal(res.body.data.username, 'qa.admin');
    assert.equal(res.body.data.email, null);
    const profile = await request(http)
      .get('/api/v1/auth/me')
      .set('Cookie', res.headers['set-cookie'][0].split(';')[0])
      .expect(200);
    assert.equal(profile.body.data.username, 'qa.admin');
    await assert.rejects(
      db.user.create({ data: { username: 'qa.admin', passwordHash: 'test' } }),
    );
  });

  const mutation = (path) =>
    request(http)
      .post(path)
      .set('Origin', process.env.APP_BASE_URL)
      .set('Cookie', cookie);
  await check('public health trailing slash', () =>
    request(http).get('/api/v1/health/live/').expect(200),
  );
  await check('public health HEAD', () =>
    request(http).head('/api/v1/health/live').expect(200),
  );
  await check('login trailing slash', () =>
    request(http)
      .post('/api/v1/auth/login/')
      .set('Origin', process.env.APP_BASE_URL)
      .send({ email, password })
      .expect(201),
  );
  await check('malformed JSON returns400 with requestId', async () => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .set('Origin', process.env.APP_BASE_URL)
      .send('{bad json')
      .expect(400);
    assert.equal(res.body.requestId, res.headers['x-request-id']);
    assert(res.body.requestId);
  });
  await check('multibyte invalid CSRF returns403 rather than500', () =>
    mutation('/api/v1/auth/change-password')
      .set('X-CSRF-Token', 'é'.repeat(64))
      .send({ currentPassword: password, newPassword: password + 'new' })
      .expect(403),
  );
  await check('failed CSRF does not write session lastUsedAt', async () => {
    await db.authSession.updateMany({ data: { lastUsedAt: new Date(0) } });
    await mutation('/api/v1/auth/change-password')
      .set('X-CSRF-Token', 'invalid')
      .send({ currentPassword: password, newPassword: password + 'new' })
      .expect(403);
    const sessions = await db.authSession.findMany();
    assert(sessions.every((s) => s.lastUsedAt.getTime() === 0));
  });
  await check(
    'wrong current password returns422 with session retained',
    async () => {
      await mutation('/api/v1/auth/change-password')
        .set('X-CSRF-Token', login.body.data.csrfToken)
        .send({ currentPassword: 'wrong', newPassword: password + 'new' })
        .expect(422);
      await request(http)
        .get('/api/v1/auth/me')
        .set('Cookie', cookie)
        .expect(200);
    },
  );
  await check(
    'session revoked while password request waits cannot change password',
    async () => {
      let unlock, locked;
      const release = new Promise((resolve) => {
        unlock = resolve;
      });
      const acquired = new Promise((resolve) => {
        locked = resolve;
      });
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      const hold = db.$transaction(
        async (tx) => {
          await db.lockRow(tx, 'User', user.id);
          locked();
          await release;
        },
        { timeout: 10000 },
      );
      await acquired;
      await db.authSession.updateMany({ data: { lastUsedAt: new Date(0) } });
      const result = mutation('/api/v1/auth/change-password')
        .set('X-CSRF-Token', login.body.data.csrfToken)
        .send({ currentPassword: password, newPassword: password + 'new' })
        .then((res) => res);
      try {
        const deadline = Date.now() + 5000;
        while (
          !(await db.authSession.findFirst({
            where: { lastUsedAt: { gt: new Date(0) } },
          }))
        ) {
          assert(Date.now() < deadline, 'password request did not pass guard');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await db.authSession.updateMany({ data: { revokedAt: new Date() } });
      } finally {
        unlock();
        await hold;
      }
      assert.equal((await result).status, 401);
      assert(
        await argon2.verify(
          (await db.user.findUniqueOrThrow({ where: { email } })).passwordHash,
          password,
        ),
      );
    },
  );
  await check('expired password mutation returns401', async () => {
    await db.authSession.updateMany({ data: { expiresAt: new Date(0) } });
    await mutation('/api/v1/auth/change-password')
      .set('X-CSRF-Token', login.body.data.csrfToken)
      .send({ currentPassword: password, newPassword: password + 'new' })
      .expect(401);
  });
  assert.equal(failures.length, 0, failures.join(', '));
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await app.close();
}
