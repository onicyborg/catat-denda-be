import 'dotenv/config';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  copyFile,
  readdir,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import {
  backupDatabase,
  restoreDatabase,
  pruneBackups,
  cleanDatabaseUrl,
} from './ops/database-backup.mjs';
import {
  grantApplicationPrivileges,
  quoteIdentifier as qi,
} from './ops/privileges.mjs';
const original = cleanDatabaseUrl(process.env.DATABASE_URL),
  suffix = randomBytes(6).toString('hex'),
  sourceName = 'qa_rehearsal_' + suffix,
  targetName = 'qa_restore_' + suffix,
  runtime = 'qa_runtime_' + suffix,
  backupRole = 'qa_backup_' + suffix;
const source = new URL(original),
  target = new URL(original);
source.pathname = '/' + sourceName;
target.pathname = '/' + targetName;
const admin = new pg.Client({ connectionString: original.toString() });
await admin.connect();
const work = await mkdtemp(join(tmpdir(), 'catat-recovery-'));
let app, db;
const started = performance.now();
try {
  await admin.query(`CREATE DATABASE ${qi(sourceName)} TEMPLATE template0`);
  await admin.query(`CREATE DATABASE ${qi(targetName)} TEMPLATE template0`);
  const rolePassword = randomBytes(32).toString('hex');
  await admin.query(
    `CREATE ROLE ${qi(runtime)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${rolePassword}'`,
  );
  await admin.query(
    `CREATE ROLE ${qi(backupRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${rolePassword}'`,
  );
  await admin.query(`REVOKE ALL ON DATABASE ${qi(sourceName)} FROM PUBLIC`);
  await admin.query(`REVOKE ALL ON DATABASE ${qi(targetName)} FROM PUBLIC`);
  await admin.query(
    `GRANT CONNECT ON DATABASE ${qi(sourceName)} TO ${qi(runtime)},${qi(backupRole)}`,
  );
  process.env.DATABASE_URL = source.toString();
  process.env.NODE_ENV = 'test';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  const migrateStart = performance.now();
  execFileSync('pnpm', ['prisma:deploy'], { env: process.env, stdio: 'pipe' });
  execFileSync('pnpm', ['prisma:deploy'], { env: process.env, stdio: 'pipe' });
  const migrationMs = performance.now() - migrateStart;
  const password = randomBytes(24).toString('hex');
  execFileSync('pnpm', ['admin:bootstrap'], {
    env: {
      ...process.env,
      ADMIN_BOOTSTRAP_USERNAME: 'recovery.admin',
      ADMIN_BOOTSTRAP_PASSWORD: password,
    },
    stdio: 'pipe',
  });
  const { AppModule } = await import('../dist/app.module.js');
  app = await NestFactory.create(AppModule, { logger: false });
  configure(app);
  await app.init();
  db = app.get(PrismaService);
  let server = app.getHttpServer();
  const login = await request(server)
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_BASE_URL)
    .send({ username: 'recovery.admin', password })
    .expect(201);
  let cookie = login.headers['set-cookie'][0].split(';')[0],
    csrf = login.body.data.csrfToken;
  const write = (path, data) =>
    request(server)
      .post('/api/v1' + path)
      .set('Origin', process.env.APP_BASE_URL)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', crypto.randomUUID())
      .send(data);
  const e = (
      await write('/employees', {
        displayName: 'Recovery QA',
        employeeCode: 'REC',
      }).expect(201)
    ).body.data,
    t = (
      await write('/violation-types', {
        code: 'REC',
        name: 'Recovery test',
        category: 'OTHER',
        defaultAmountPerPerson: 5000,
      }).expect(201)
    ).body.data;
  let fine = (
    await write('/fine-cases', {
      occurredAt: '2026-01-01T00:00:00+07:00',
      violationTypeId: t.id,
      description: 'Explicit recovery fixture',
      members: [{ employeeId: e.id, assignedAmount: 5000 }],
    }).expect(201)
  ).body.data;
  fine = (
    await write(`/fine-cases/${fine.id}/post`, { version: 1 }).expect(201)
  ).body.data;
  await write(`/fine-members/${fine.members[0].id}/payments`, {
    amount: 2000,
    method: 'CASH',
    effectiveAt: '2026-01-02T00:00:00+07:00',
  }).expect(201);
  const dbOwner = new pg.Client({ connectionString: source.toString() });
  await dbOwner.connect();
  await grantApplicationPrivileges(dbOwner, runtime, backupRole);
  await dbOwner.end();
  const runtimeUrl = new URL(source);
  runtimeUrl.username = runtime;
  runtimeUrl.password = rolePassword;
  const restricted = new pg.Client({ connectionString: runtimeUrl.toString() });
  await restricted.connect();
  for (const sql of [
    'CREATE TABLE public.forbidden(id int)',
    'DROP TABLE "FineCase"',
    'DELETE FROM "PaymentEntry"',
    'UPDATE "AuditLog" SET action=\'changed\'',
    'UPDATE "User" SET "isActive"=false',
    'INSERT INTO "User"(id,"passwordHash","updatedAt") VALUES(gen_random_uuid(),\'invalid\',now())',
  ])
    await assert.rejects(
      restricted.query(sql),
      (error) => error.code === '42501',
    );
  await restricted.end();
  const sourceBackup = new URL(source);
  sourceBackup.username = backupRole;
  sourceBackup.password = rolePassword;
  const counts = async (url) => {
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      const result = {};
      for (const table of [
        '_prisma_migrations',
        'User',
        'Employee',
        'ViolationType',
        'FineCase',
        'FineCaseMember',
        'PaymentEntry',
        'AuditLog',
      ])
        result[table] = (
          await client.query(`SELECT count(*)::text AS n FROM ${qi(table)}`)
        ).rows[0].n;
      return result;
    } finally {
      await client.end();
    }
  };
  const before = await counts(source);
  await app.close();
  app = null;
  const keyFile = join(work, 'backup.key'),
    wrongKey = join(work, 'wrong.key');
  await writeFile(keyFile, randomBytes(48).toString('hex'), { mode: 0o600 });
  await writeFile(wrongKey, randomBytes(48).toString('hex'), { mode: 0o600 });
  const backupStarted = Date.now(),
    result = await backupDatabase({
      databaseUrl: sourceBackup.toString(),
      keyFile,
      outputDir: join(work, 'backups'),
    });
  const archive = await readFile(result.archive);
  assert(!archive.includes(Buffer.from('Explicit recovery fixture')));
  assert(!archive.includes(Buffer.from(password)));
  assert.throws(() =>
    cleanDatabaseUrl('postgresql://localhost/qa?password=secret'),
  );
  await chmod(wrongKey, 0o644);
  await assert.rejects(
    backupDatabase({
      databaseUrl: sourceBackup.toString(),
      keyFile: wrongKey,
      outputDir: join(work, 'backups'),
    }),
  );
  await chmod(wrongKey, 0o600);
  const altered = Buffer.from(archive);
  altered[40] ^= 1;
  const tamperedPath = join(work, 'tampered.dump.enc');
  await writeFile(tamperedPath, altered, { mode: 0o600 });
  const alteredManifest = JSON.parse(await readFile(result.manifest, 'utf8'));
  await writeFile(
    tamperedPath + '.json',
    JSON.stringify({
      ...alteredManifest,
      file: 'tampered.dump.enc',
      sha256: createHash('sha256').update(altered).digest('hex'),
    }),
    { mode: 0o600 },
  );
  await assert.rejects(
    restoreDatabase({
      databaseUrl: target.toString(),
      keyFile,
      archive: tamperedPath,
      confirmDatabase: targetName,
    }),
  );
  await assert.rejects(
    restoreDatabase({
      databaseUrl: target.toString(),
      keyFile: wrongKey,
      archive: result.archive,
      confirmDatabase: targetName,
    }),
  );
  assert.equal((await counts(source)).FineCase, '1');
  const restoreStarted = performance.now();
  await restoreDatabase({
    databaseUrl: target.toString(),
    keyFile,
    archive: result.archive,
    confirmDatabase: targetName,
  });
  const restoreMs = performance.now() - restoreStarted;
  assert.deepEqual(await counts(target), before);
  await assert.rejects(
    restoreDatabase({
      databaseUrl: target.toString(),
      keyFile,
      archive: result.archive,
      confirmDatabase: targetName,
    }),
  );
  await assert.rejects(
    restoreDatabase({
      databaseUrl: target.toString(),
      keyFile,
      archive: result.archive,
      confirmDatabase: sourceName,
    }),
  );
  const snapshot = execFileSync(
    process.execPath,
    ['scripts/verify-restored-smoke.mjs'],
    {
      env: {
        ...process.env,
        DATABASE_URL: target.toString(),
        QA_ADMIN_PASSWORD: password,
        QA_FINE_ID: fine.id,
      },
      encoding: 'utf8',
    },
  );
  assert(snapshot.includes('RESTORED_SMOKE_PASS'));
  const owner = new pg.Client({ connectionString: target.toString() });
  await owner.connect();
  await grantApplicationPrivileges(owner, runtime, backupRole);
  await owner.end();
  await admin.query(
    `GRANT CONNECT ON DATABASE ${qi(targetName)} TO ${qi(runtime)}`,
  );
  const restoredRuntime = new URL(target);
  restoredRuntime.username = runtime;
  restoredRuntime.password = rolePassword;
  const runtimeSmoke = execFileSync(
    process.execPath,
    ['scripts/verify-restored-smoke.mjs'],
    {
      env: {
        ...process.env,
        DATABASE_URL: restoredRuntime.toString(),
        QA_VERIFY_WRITES: 'true',
        QA_ADMIN_PASSWORD: password,
        QA_FINE_ID: fine.id,
      },
      encoding: 'utf8',
    },
  );
  assert(runtimeSmoke.includes('RESTORED_SMOKE_PASS'));
  // Retention touches only complete generated archives and preserves at least14 recovery points.
  const manifest = JSON.parse(await readFile(result.manifest, 'utf8'));
  for (let n = 1; n <= 15; n++) {
    const date = new Date(Date.now() - (n + 20) * 86400000),
      stamp =
        date
          .toISOString()
          .slice(0, 19)
          .replaceAll('-', '')
          .replaceAll(':', '') + 'Z',
      name = `catat-denda_${stamp}_${randomBytes(6).toString('hex')}.dump.enc`,
      path = join(work, 'backups', name);
    await copyFile(result.archive, path);
    await writeFile(
      path + '.json',
      JSON.stringify({
        ...manifest,
        file: name,
        createdAt: date.toISOString(),
      }),
      { mode: 0o600 },
    );
  }
  await writeFile(join(work, 'backups', 'unrelated.txt'), 'keep', {
    mode: 0o600,
  });
  const retention = await pruneBackups(join(work, 'backups'));
  assert.equal(retention.retained, 14);
  assert.equal(retention.removed.length, 2);
  assert((await readdir(join(work, 'backups'))).includes('unrelated.txt'));
  const report = {
    scope: 'isolated local database rehearsal, not production recovery',
    timestamp: new Date().toISOString(),
    migrationDeployRuns: 2,
    migrationMs: Number(migrationMs.toFixed(1)),
    sourceCounts: before,
    encryptedBackupBytes: result.bytes,
    backupEncrypted: true,
    wrongKeyRejected: true,
    tamperedCiphertextRejected: true,
    unsafeKeyPermissionsRejected: true,
    nonemptyTargetRejected: true,
    restoreMs: Number(restoreMs.toFixed(1)),
    totalRecoveryMs: Number((performance.now() - started).toFixed(1)),
    observedSnapshotAgeMs: Date.now() - backupStarted,
    rpoOperationalHoursTarget: 24,
    rtoOperationalHoursTarget: 24,
    retention,
    leastPrivilegeSmoke: true,
  };
  await writeFile(
    '/tmp/catat-denda-phase6-recovery.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  if (app) await app.close();
  for (const name of [sourceName, targetName])
    await admin.query(`DROP DATABASE IF EXISTS ${qi(name)} WITH (FORCE)`);
  for (const role of [runtime, backupRole])
    await admin.query(`DROP ROLE IF EXISTS ${qi(role)}`);
  await admin.end();
  await rm(work, { recursive: true, force: true });
}
