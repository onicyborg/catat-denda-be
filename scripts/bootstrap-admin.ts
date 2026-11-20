import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import * as argon2 from 'argon2';
import { z } from 'zod';
const email = process.env.ADMIN_BOOTSTRAP_EMAIL
  ? z
      .email()
      .max(254)
      .parse(process.env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase())
  : undefined;
const username = process.env.ADMIN_BOOTSTRAP_USERNAME
  ? z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/)
      .parse(process.env.ADMIN_BOOTSTRAP_USERNAME.trim().toLowerCase())
  : undefined;
if (!email && !username)
  throw new Error('Isi ADMIN_BOOTSTRAP_USERNAME atau ADMIN_BOOTSTRAP_EMAIL.');
const password = z
  .string()
  .min(12)
  .max(256)
  .parse(process.env.ADMIN_BOOTSTRAP_PASSWORD);
const db = new PrismaClient({
  adapter: new PrismaPg(
    { connectionString: process.env.DATABASE_URL! },
    {
      schema:
        new URL(process.env.DATABASE_URL!).searchParams.get('schema') ??
        'public',
    },
  ),
});
try {
  if (
    await db.user.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(username ? [{ username }] : []),
        ],
      },
    })
  )
    throw new Error('Admin sudah tersedia; password tidak diubah.');
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        username,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    await tx.appSettings.upsert({
      where: { singletonKey: 1 },
      create: { businessName: 'Catat Denda', updatedBy: user.id },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'ADMIN_BOOTSTRAP',
        entityType: 'User',
        entityId: user.id,
      },
    });
  });
  console.log(
    'Admin berhasil dibuat. Hapus environment provisioning setelah selesai.',
  );
} finally {
  await db.$disconnect();
}
