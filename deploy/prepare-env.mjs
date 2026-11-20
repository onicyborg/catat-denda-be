import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';

const input = parse(readFileSync('.env.next'));
const domain = process.argv[2];
if (!/^[a-z0-9.-]+$/.test(domain)) throw new Error('Invalid backend domain');
const origin = process.argv[3];
if (new URL(origin).origin !== origin || !origin.startsWith('https://'))
  throw new Error('Invalid frontend origin');
for (const key of ['DATABASE_URL', 'SESSION_SECRET'])
  if (!input[key]) throw new Error(`Missing ${key}`);
if (input.SESSION_SECRET.length < 32)
  throw new Error('Session secret too short');
const writeEnv = (file, values) =>
  writeFileSync(
    file,
    Object.entries(values)
      .map(([key, value]) => {
        if (/[\r\n]/.test(value)) throw new Error(`Invalid multiline ${key}`);
        return `${key}=${value}`;
      })
      .join('\n') + '\n',
    { mode: 0o600 },
  );
writeEnv('.env.admin', {
  DATABASE_URL:
    input.MIGRATION_DATABASE_URL ??
    input.DATABASE_URL_UNPOOLED ??
    input.DATABASE_URL,
  ...(input.SEED_ADMIN_PASSWORD
    ? { SEED_ADMIN_PASSWORD: input.SEED_ADMIN_PASSWORD }
    : {}),
});
const credentials = existsSync('.db-roles.json')
  ? JSON.parse(readFileSync('.db-roles.json', 'utf8'))
  : {
      runtimePassword: randomBytes(32).toString('hex'),
      backupPassword: randomBytes(32).toString('hex'),
    };
writeFileSync('.db-roles.json', JSON.stringify(credentials), { mode: 0o600 });
const runtimeUrl = new URL(input.DATABASE_URL);
runtimeUrl.username = 'catat_denda_runtime';
runtimeUrl.password = credentials.runtimePassword;
writeEnv('.env.runtime.next', {
  NODE_ENV: 'production',
  PORT: '3001',
  APP_BASE_URL: origin,
  API_PUBLIC_URL: `https://${domain}`,
  DATABASE_URL: runtimeUrl.href,
  SESSION_SECRET: input.SESSION_SECRET,
  SESSION_TTL_HOURS: input.SESSION_TTL_HOURS ?? '24',
  TRUST_PROXY_LOOPBACK: 'true',
  CSV_MAX_DAYS: input.CSV_MAX_DAYS ?? '366',
  CSV_MAX_ROWS: input.CSV_MAX_ROWS ?? '10000',
});
