import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
const url = new URL(process.env.DATABASE_URL);
const schema = 'qa_' + randomBytes(6).toString('hex');
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
process.env.APP_BASE_URL = 'http://localhost:3100';
execFileSync('pnpm', ['prisma:deploy'], { env: process.env, stdio: 'pipe' });
const { AppModule } = await import('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false });
configure(app);
const db = app.get(PrismaService);
// These credentials exist only in a disposable QA schema on loopback.
await db.user.create({
  data: {
    email: 'browser@example.test',
    passwordHash: await argon2.hash('QA-only-password-12345'),
  },
});
await app.listen(3101, '127.0.0.1');
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await app.close();
    process.exit(0);
  });
console.log('Browser QA API ready on127.0.0.1:3101');
