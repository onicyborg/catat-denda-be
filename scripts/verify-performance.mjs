import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { Agent, request as httpRequest } from 'node:http';
import { NestFactory } from '@nestjs/core';
import argon2 from 'argon2';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
const schema = 'qa_perf_' + randomBytes(6).toString('hex');
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.NODE_ENV = 'production';
process.env.APP_BASE_URL = 'https://qa-perf.example.test';
process.env.TRUST_PROXY_LOOPBACK = 'false';
execFileSync('pnpm', ['prisma:deploy'], { env: process.env, stdio: 'pipe' });
const { AppModule } = await import('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false });
configure(app);
await app.listen(0, '127.0.0.1');
const db = app.get(PrismaService),
  base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
try {
  const encoded = await argon2.hash(randomBytes(32));
  const users = Array.from({ length: 10 }, (_, i) => ({
    id: randomUUID(),
    username: 'perf.admin.' + i,
    passwordHash: encoded,
  }));
  await db.user.createMany({ data: users });
  const tokens = users.map(() => randomBytes(32).toString('hex'));
  await db.authSession.createMany({
    data: users.map((u, i) => ({
      userId: u.id,
      tokenHash: createHash('sha256').update(tokens[i]).digest('hex'),
      expiresAt: new Date(Date.now() + 3600000),
    })),
  });
  const employees = Array.from({ length: 100 }, (_, i) => ({
    id: randomUUID(),
    displayName: 'Perf person ' + i,
    normalizedName: 'perf person ' + i,
    employeeCode: 'PERF-' + i,
  }));
  await db.employee.createMany({ data: employees });
  const type = await db.violationType.create({
    data: {
      code: 'PERF',
      name: 'Performance fixture',
      category: 'OTHER',
      defaultAmountPerPerson: 5000,
    },
  });
  const cases = Array.from({ length: 10000 }, (_, i) => ({
    id: randomUUID(),
    createdBy: users[i % 10].id,
    postedBy: users[i % 10].id,
    postedAt: new Date('2026-01-02T00:00:00Z'),
    occurredAt: new Date('2026-01-01T00:00:00+07:00'),
    violationTypeId: type.id,
    violationCodeSnapshot: 'PERF',
    violationNameSnapshot: type.name,
    violationCategorySnapshot: 'OTHER',
    defaultRateSnapshot: 5000,
    status: 'POSTED',
    description: 'Explicit synthetic performance fixture ' + i,
  }));
  const members = cases.flatMap((c, i) =>
    Array.from({ length: 4 }, (_, j) => ({
      id: randomUUID(),
      fineCaseId: c.id,
      employeeId: employees[(i + j) % 100].id,
      employeeNameSnapshot: employees[(i + j) % 100].displayName,
      assignedAmount: 5000,
    })),
  );
  const payments = cases.flatMap((c, i) =>
    [2000, 1000].map((amount, j) => ({
      id: randomUUID(),
      fineCaseMemberId: members[i * 4].id,
      amount,
      kind: 'PAYMENT',
      method: 'CASH',
      effectiveAt: new Date('2026-01-02T00:00:00+07:00'),
      idempotencyKey: randomUUID(),
      requestHash: createHash('sha256')
        .update(c.id + ':' + j)
        .digest('hex'),
      recordedBy: users[i % 10].id,
    })),
  );
  const insert = async (model, rows, size = 500) => {
    for (let i = 0; i < rows.length; i += size)
      await model.createMany({ data: rows.slice(i, i + size) });
  };
  await insert(db.fineCase, cases);
  await insert(db.fineCaseMember, members, 1000);
  await insert(db.paymentEntry, payments, 1000);
  await insert(
    db.auditLog,
    cases.map((c) => ({
      actorUserId: c.createdBy,
      action: 'PERF_FIXTURE',
      entityType: 'FineCase',
      entityId: c.id,
    })),
    1000,
  );
  for (const table of [
    'FineCase',
    'FineCaseMember',
    'PaymentEntry',
    'Employee',
    'AuditLog',
  ])
    await db.$executeRawUnsafe(`ANALYZE "${schema}"."${table}"`);
  const headers = (i) => ({
    Host: 'qa-perf.example.test',
    Cookie: 'efms_session=' + tokens[i],
  });
  const agent = new Agent({ keepAlive: true, maxSockets: 10 });
  const get = (route, index) =>
    new Promise((resolve, reject) => {
      const request = httpRequest(
        base + '/api/v1' + route,
        { headers: headers(index), agent },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              body: Buffer.concat(chunks),
            }),
          );
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end();
    });
  const routes = [
    '/fine-cases?limit=20',
    '/payments?limit=20',
    '/dashboard/summary?from=2026-01-01&to=2026-01-31',
    '/reports/summary?from=2026-01-01&to=2026-01-31',
    '/reports/employee-balances?from=2026-01-01&to=2026-01-31',
    '/audit-logs?limit=20',
  ];
  const probe = await get('/reports/summary?from=2026-01-01&to=2026-01-31', 0);
  assert.equal(probe.status, 200, probe.body.toString());
  const expected = JSON.parse(probe.body.toString());
  assert.equal(expected.data.caseCount, '10000');
  assert.equal(expected.data.assessedAmount, '200000000');
  assert.equal(expected.data.currentOutstandingAmount, '170000000');
  const measurements = [];
  for (const route of routes) {
    const samples = [];
    await Promise.all(
      users.map(async (_, i) => {
        const warm = await get(route, i);
        assert.equal(warm.status, 200);
        for (let n = 0; n < 8; n++) {
          const start = performance.now();
          const response = await get(route, i);
          assert.equal(
            response.status,
            200,
            route + ' HTTP ' + response.status,
          );
          samples.push(performance.now() - start);
        }
      }),
    );
    samples.sort((a, b) => a - b);
    measurements.push({
      route,
      samples: samples.length,
      p50Ms: Number(samples[Math.ceil(samples.length * 0.5) - 1].toFixed(2)),
      p95Ms: Number(samples[Math.ceil(samples.length * 0.95) - 1].toFixed(2)),
      maxMs: Number(samples.at(-1).toFixed(2)),
      pass: samples[Math.ceil(samples.length * 0.95) - 1] < 1000,
    });
  }
  const [server] =
    await db.$queryRaw`SELECT current_setting('server_version') AS version`;
  const result = {
    scope:
      'isolated local, compiled API in production mode; no external TLS/network latency',
    timestamp: new Date().toISOString(),
    node: process.version,
    postgres: server.version,
    cpus: os.availableParallelism(),
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    cases: cases.length,
    members: members.length,
    ledgerEntries: payments.length,
    concurrentAdmins: 10,
    measurements,
  };
  await writeFile(
    '/tmp/catat-denda-phase6-performance.json',
    JSON.stringify(result, null, 2),
  );
  agent.destroy();
  console.log(JSON.stringify(result));
  assert(
    measurements.every((m) => m.pass),
    'p95 target exceeded; inspect benchmark artifact',
  );
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await app.close();
}
