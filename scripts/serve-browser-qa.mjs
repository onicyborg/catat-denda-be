import 'dotenv/config';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import { configure } from '../dist/http.js';
import { PrismaService } from '../dist/prisma/prisma.service.js';
const url = new URL(process.env.DATABASE_URL);
const release = process.env.RELEASE_QA === 'true';
const password = release
  ? randomBytes(24).toString('hex')
  : 'QA-only-password-12345';
const schema = 'qa_' + randomBytes(6).toString('hex');
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.NODE_ENV = release ? 'production' : 'test';
process.env.APP_BASE_URL = release
  ? 'https://localhost:3443'
  : 'http://localhost:3100';
process.env.TRUST_PROXY_LOOPBACK = release ? 'true' : 'false';
execFileSync('pnpm', ['prisma:deploy'], { env: process.env, stdio: 'pipe' });
const { AppModule } = await import('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false });
configure(app);
const db = app.get(PrismaService);
// These credentials exist only in a disposable QA schema on loopback.
await db.user.create({
  data: {
    username: 'browser.admin',
    email: 'browser@example.test',
    passwordHash: await argon2.hash(password),
  },
});
const masterToken = randomBytes(32).toString('hex');
const master = await db.user.create({
  data: {
    username: 'master.browser',
    passwordHash: await argon2.hash(randomBytes(32)),
  },
});
await db.authSession.create({
  data: {
    userId: master.id,
    tokenHash: createHash('sha256').update(masterToken).digest('hex'),
    expiresAt: new Date(Date.now() + 3600000),
  },
});
const stateFile = release
  ? '/tmp/catat-denda-release-session.json'
  : '/tmp/catat-denda-master-qa-session.json';
const credentialsFile = '/tmp/catat-denda-release-credentials.json';
if (release)
  writeFileSync(
    credentialsFile,
    JSON.stringify({ username: 'browser.admin', password }),
    { mode: 0o600 },
  );
writeFileSync(
  stateFile,
  JSON.stringify({
    cookies: [
      {
        name: 'efms_session',
        value: masterToken,
        domain: 'localhost',
        path: '/api/v1',
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: release,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  }),
  { mode: 0o600 },
);
await app.listen(release ? 3201 : 3101, '127.0.0.1');
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await app.close();
    unlinkSync(stateFile);
    if (release) unlinkSync(credentialsFile);
    process.exit(0);
  });
console.log(`Browser QA API ready on127.0.0.1:${release ? 3201 : 3101}`);
