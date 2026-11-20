import { readFileSync } from 'node:fs';
import pg from 'pg';
import { grantApplicationPrivileges } from '../scripts/ops/privileges.mjs';
const passwords = JSON.parse(readFileSync('/run/deploy/db-roles.json', 'utf8'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const [role, password] of [
    ['catat_denda_runtime', passwords.runtimePassword],
    ['catat_denda_backup', passwords.backupPassword],
  ]) {
    if (!/^[a-f0-9]{64}$/.test(password))
      throw new Error('Invalid role password');
    const exists = await client.query(
      'SELECT 1 FROM pg_roles WHERE rolname=$1',
      [role],
    );
    if (!exists.rowCount)
      await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
  }
  await grantApplicationPrivileges(
    client,
    'catat_denda_runtime',
    'catat_denda_backup',
  );
  console.log('Runtime and backup database privileges configured.');
} finally {
  await client.end();
}
