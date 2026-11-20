import 'dotenv/config';
import { parseArgs } from 'node:util';
import { restoreDatabase } from './database-backup.mjs';
const { values } = parseArgs({
  options: {
    archive: { type: 'string' },
    'key-file': { type: 'string' },
    'confirm-database': { type: 'string' },
  },
});
try {
  if (
    !process.env.RESTORE_DATABASE_URL ||
    !values.archive ||
    !values['key-file']
  )
    throw new Error('Parameter restore belum lengkap.');
  console.log(
    JSON.stringify(
      await restoreDatabase({
        databaseUrl: process.env.RESTORE_DATABASE_URL,
        keyFile: values['key-file'],
        archive: values.archive,
        confirmDatabase: values['confirm-database'],
      }),
    ),
  );
} catch {
  console.error(
    'Restore gagal. Database tujuan harus baru/kosong, konfirmasi nama harus tepat, dan arsip/kunci harus valid. Tidak menggunakan restore --clean.',
  );
  process.exitCode = 1;
}
