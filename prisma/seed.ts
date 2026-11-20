import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedInitialData } from './seed-initial.js';

let db: PrismaClient | undefined;
try {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('DATABASE_URL wajib PostgreSQL.');
  db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url.toString() },
      { schema: url.searchParams.get('schema') ?? 'public' },
    ),
  });
  console.log(
    JSON.stringify(await seedInitialData(db, process.env.SEED_ADMIN_PASSWORD)),
  );
} catch (error) {
  // Database exceptions may include private source data or connection parameters.
  console.error(
    error instanceof Error && error.message.startsWith('Akun baru memerlukan')
      ? error.message
      : 'Seed gagal dan transaksi dibatalkan. Periksa migrasi, izin owner, credential seed, identitas/alias dan manifest batch.',
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
