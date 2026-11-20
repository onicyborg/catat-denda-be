import 'dotenv/config';
import { parseArgs } from 'node:util';
import { backupDatabase, pruneBackups } from './database-backup.mjs';
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    'key-file': { type: 'string' },
    prune: { type: 'boolean', default: false },
  },
});
try {
  if (!process.env.BACKUP_DATABASE_URL || !values.output || !values['key-file'])
    throw new Error('Isi BACKUP_DATABASE_URL, --output dan --key-file.');
  const result = await backupDatabase({
    databaseUrl: process.env.BACKUP_DATABASE_URL,
    keyFile: values['key-file'],
    outputDir: values.output,
  });
  console.log(JSON.stringify(result));
  if (values.prune)
    console.log(JSON.stringify(await pruneBackups(values.output)));
} catch {
  console.error(
    'Backup gagal; tidak ada arsip parsial yang dinyatakan sukses. Periksa koneksi, izin, client PostgreSQL dan kunci.',
  );
  process.exitCode = 1;
}
