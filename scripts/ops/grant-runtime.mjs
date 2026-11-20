import 'dotenv/config';
import pg from 'pg';
import { parseArgs } from 'node:util';
import { cleanDatabaseUrl } from './database-backup.mjs';
import { grantApplicationPrivileges } from './privileges.mjs';
const { values } = parseArgs({
  options: {
    'runtime-role': { type: 'string' },
    'backup-role': { type: 'string' },
  },
});
const db = new pg.Client({
  connectionString: cleanDatabaseUrl(
    process.env.MIGRATION_DATABASE_URL,
  ).toString(),
});
try {
  await db.connect();
  await grantApplicationPrivileges(
    db,
    values['runtime-role'],
    values['backup-role'],
  );
  console.log(
    'Hak runtime/backup diterapkan. Role, password dan CONNECT database harus disiapkan operator.',
  );
} catch {
  console.error(
    'Penerapan hak gagal. Gunakan koneksi pemilik schema dan role terpisah yang sudah dibuat.',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
