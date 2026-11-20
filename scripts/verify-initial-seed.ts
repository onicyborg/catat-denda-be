import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedInitialData, seedId } from '../prisma/seed-initial.js';
import { initialIncidents } from '../prisma/initial-data.js';
import * as argon2 from 'argon2';

const schema = 'qa_seed_' + randomBytes(6).toString('hex');
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
execFileSync('pnpm', ['prisma:deploy'], { env: process.env, stdio: 'pipe' });
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});
try {
  await assert.rejects(seedInitialData(db));
  assert.equal(await db.user.count(), 0);
  const password = randomBytes(20).toString('hex');
  const conflict = await db.employee.create({
    data: { displayName: 'Alias conflict', normalizedName: 'alias conflict' },
  });
  await db.employeeAlias.create({
    data: {
      employeeId: conflict.id,
      aliasDisplay: 'El',
      aliasNormalized: 'el',
    },
  });
  await assert.rejects(seedInitialData(db, password), /ambigu/);
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.fineCase.count(), 0);
  assert.equal(await db.employee.count(), 1);
  await db.employeeAlias.deleteMany({ where: { employeeId: conflict.id } });
  await db.employee.delete({ where: { id: conflict.id } });
  // Different seed processes share the transaction lock; only one creates rows.
  const results = await Promise.all([
    seedInitialData(db, password),
    seedInitialData(db, password),
  ]);
  assert.equal(
    results.reduce((n, row) => n + row.casesCreated, 0),
    18,
  );
  assert.equal(await db.user.count(), 1);
  assert.equal(await db.employee.count(), 11);
  assert.equal(await db.fineCase.count(), 18);
  assert.equal(await db.fineCaseMember.count(), 23);
  assert.equal(await db.fineCaseCreation.count(), 18);
  assert.equal(await db.violationType.count(), 0);
  assert.equal(await db.paymentEntry.count(), 0);
  assert.equal(await db.fineCase.count({ where: { status: 'POSTED' } }), 0);
  assert.equal(
    await db.fineCase.count({
      where: { occurredAt: null, violationTypeId: null, status: 'DRAFT' },
    }),
    18,
  );
  assert.equal(
    await db.fineCaseMember.count({ where: { assignedAmount: null } }),
    3,
  );
  assert.equal(
    (await db.fineCaseMember.aggregate({ _sum: { assignedAmount: true } }))._sum
      .assignedAmount,
    105000,
  );
  const admin = await db.user.findUniqueOrThrow({
    where: { username: 'defyana' },
  });
  assert(await argon2.verify(admin.passwordHash, password));
  assert(admin.passwordHash.startsWith('$argon2id$'));
  const cases = await db.fineCase.findMany({ include: { members: true } });
  for (const [index, incident] of initialIncidents.entries()) {
    const row = cases.find((c) => c.id === seedId('case:' + (index + 1)))!;
    assert.equal(row.sourceText, incident.sourceText);
    assert.equal(row.description, incident.description);
    assert.equal(row.members.length, incident.employees.length);
    assert.equal(
      row.members.reduce((n, m) => n + (m.assignedAmount ?? 0), 0),
      incident.total ?? 0,
    );
  }
  assert.equal(
    cases.find((c) => c.id === seedId('case:11'))!.members[0].assignedAmount,
    5000,
  );
  assert(
    cases
      .find((c) => c.id === seedId('case:11'))!
      .description!.includes('2000'),
  );
  assert.notEqual(seedId('employee:el'), seedId('employee:elvina'));
  assert.notEqual(seedId('employee:davin'), seedId('employee:dhafin'));
  const edited = seedId('case:1');
  await db.fineCase.update({
    where: { id: edited },
    data: { description: 'Edited by administrator', version: { increment: 1 } },
  });
  await db.appSettings.update({
    where: { id: 1 },
    data: { businessName: 'Existing business', version: { increment: 1 } },
  });
  const audits = await db.auditLog.count();
  await db.employee.update({
    where: { id: seedId('employee:fauzi') },
    data: { displayName: 'Fauzi revised', normalizedName: 'fauzi revised' },
  });
  const again = await seedInitialData(db, randomBytes(20).toString('hex'));
  assert.equal(again.casesCreated, 0);
  assert.equal(again.employeesCreated, 0);
  assert.equal(await db.auditLog.count(), audits);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash,
    admin.passwordHash,
  );
  assert.equal(
    (await db.fineCase.findUniqueOrThrow({ where: { id: edited } }))
      .description,
    'Edited by administrator',
  );
  assert.equal(
    (await db.appSettings.findUniqueOrThrow({ where: { id: 1 } })).businessName,
    'Existing business',
  );
  execFileSync('pnpm', ['db:seed'], {
    env: { ...process.env, SEED_ADMIN_PASSWORD: '' },
    stdio: 'pipe',
  });
  assert.equal(await db.auditLog.count(), audits);
  // The API must be able to read/edit deterministic UUIDs and show drafts without a date.
  process.env.NODE_ENV = 'test';
  process.env.APP_BASE_URL = 'http://localhost:3000';
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  execFileSync(process.execPath, ['scripts/verify-initial-seed-smoke.mjs'], {
    env: { ...process.env, QA_ADMIN_PASSWORD: password, QA_FINE_ID: edited },
    stdio: 'pipe',
  });
  assert.equal(
    (
      await db.employee.findUniqueOrThrow({
        where: { id: seedId('employee:fauzi') },
      })
    ).displayName,
    'Fauzi revised',
  );
  const marker = await db.fineCaseCreation.findUniqueOrThrow({
    where: { key: seedId('creation:1') },
  });
  await db.fineCaseCreation.update({
    where: { key: marker.key },
    data: { requestHash: 'changed-manifest' },
  });
  await assert.rejects(seedInitialData(db), /Manifest/);
  assert.equal(await db.fineCase.count(), 18);
  console.log(
    'PASS: initial seed18 drafts/11 employees/23 allocations/105000 known/3 unknown/0 ledger; concurrent reruns, CLI, credential preservation, audit, source integrity, identity conflicts and API review.',
  );
} finally {
  await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await db.$disconnect();
}
