import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { version as uuidVersion } from 'uuid';
const schema = 'qa_uuid_' + randomBytes(6).toString('hex');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}",public`);
  const folders = (await readdir('prisma/migrations'))
    .filter((name) => /^\d/.test(name))
    .sort();
  for (const name of folders.filter((name) => !name.endsWith('_uuid_v7')))
    await db.query(
      await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'),
    );
  const user = randomUUID(),
    fine = randomUUID();
  await db.query(
    'INSERT INTO "User"(id,username,"passwordHash","updatedAt") VALUES($1,$2,$3,now())',
    [user, 'legacy', 'test-only-hash'],
  );
  await db.query(
    'INSERT INTO "AppSettings"(id,"businessName","updatedAt","updatedBy") VALUES(1,$1,now(),$2)',
    ['Legacy business', user],
  );
  await db.query(
    'INSERT INTO "AuditLog"(id,"actorUserId",action,"entityType","entityId") VALUES($1,$2,$3,$4,$5)',
    [
      randomUUID(),
      user,
      'SETTINGS_UPDATE',
      'AppSettings',
      '00000000-0000-4000-8000-000000000001',
    ],
  );
  await db.query(
    'INSERT INTO "FineCase"(id,"createdBy","updatedAt") VALUES($1,$2,now())',
    [fine, user],
  );
  const legacyKey = 'fb415c96-84b5-57a4-bde3-6b0e3976e734';
  await db.query(
    'INSERT INTO "FineCaseCreation"(key,"actorUserId","fineCaseId","requestHash") VALUES($1,$2,$3,$4)',
    [legacyKey, user, fine, 'a'.repeat(64)],
  );
  await db.query(
    await readFile(
      'prisma/migrations/202611200006_uuid_v7/migration.sql',
      'utf8',
    ),
  );
  const settings = (await db.query('SELECT * FROM "AppSettings"')).rows[0];
  assert.equal(uuidVersion(settings.id), 7);
  assert.equal(settings.singletonKey, 1);
  assert.equal(settings.businessName, 'Legacy business');
  assert.equal(
    (await db.query('SELECT "entityId" FROM "AuditLog"')).rows[0].entityId,
    settings.id,
  );
  const marker = (await db.query('SELECT * FROM "FineCaseCreation"')).rows[0];
  assert.equal(uuidVersion(marker.id), 7);
  assert.equal(marker.key, legacyKey);
  assert.equal(marker.fineCaseId, fine);
  assert.equal(marker.seedKey, 'catat-denda:initial-2026:v1:incident:1');
  assert.equal(
    (await db.query("SELECT to_regprocedure('migration_uuid_v7()') AS fn"))
      .rows[0].fn,
    null,
  );
  console.log(
    'PASS: populated legacy schema upgrades settings/creation UUIDv7, singleton, audit reference and seed batch without loss.',
  );
} finally {
  await db.query(`DROP SCHEMA "${schema}" CASCADE`);
  await db.end();
}
