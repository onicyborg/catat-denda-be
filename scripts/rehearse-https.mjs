import 'dotenv/config';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

const backend = resolve(import.meta.dirname, '..');
const frontend = resolve(backend, '../frontend');
const image =
  'docker.io/library/nginx@sha256:4d1d4ce08432dc7dfe4af762cb224ce6b5273ae878f41e020ea2425d02ea91a4';
const container = 'catat-qa-' + randomBytes(6).toString('hex');
const children = [];
let work,
  closing = false;

async function cleanup(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  try {
    execFileSync('podman', ['stop', '--time', '5', container], {
      stdio: 'ignore',
    });
  } catch {}
  await Promise.all(
    children.map(async (child) => {
      for (
        let n = 0;
        n < 100 && child.exitCode === null && child.signalCode === null;
        n++
      )
        await delay(100);
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
    }),
  );
  if (work) await rm(work, { recursive: true, force: true });
  process.exit(code);
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => void cleanup());
function start(binary, args, options = {}) {
  const child = spawn(binary, args, {
    stdio: 'inherit',
    cwd: backend,
    ...options,
  });
  children.push(child);
  child.once('error', () => void cleanup(1));
  child.once('exit', () => {
    if (!closing) void cleanup(1);
  });
  return child;
}
async function assertFree(port) {
  await new Promise((ok, fail) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      fail(new Error('QA port already in use.'));
    });
    socket.once('error', (error) =>
      error.code === 'ECONNREFUSED' ? ok() : fail(error),
    );
  });
}
try {
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    )
  )
    throw new Error('Use a local nonproduction PostgreSQL server.');
  for (const port of [3080, 3200, 3201, 3443]) await assertFree(port);
  await access(join(backend, 'dist/main.js'));
  await access(join(frontend, '.next-release/BUILD_ID'));
  work = await mkdtemp(join(tmpdir(), 'catat-https-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      join(work, 'key.pem'),
      '-out',
      join(work, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const template = await readFile(
    join(backend, 'ops/nginx/catat-denda.conf'),
    'utf8',
  );
  const config = template
    .replace('listen 80;', 'listen 127.0.0.1:3080;')
    .replace('listen 443 ssl;', 'listen 127.0.0.1:3443 ssl;')
    .replaceAll('catat.example.com', 'localhost')
    .replace(
      'https://localhost$request_uri',
      'https://localhost:3443$request_uri',
    )
    .replace('/etc/letsencrypt/live/localhost/fullchain.pem', '/qa/cert.pem')
    .replace('/etc/letsencrypt/live/localhost/privkey.pem', '/qa/key.pem')
    .replaceAll('127.0.0.1:3001', '127.0.0.1:3201')
    .replaceAll('127.0.0.1:3000', '127.0.0.1:3200');
  await writeFile(
    join(work, 'nginx.conf'),
    'events {}\nhttp {\n' + config + '\n}\n',
    { mode: 0o600 },
  );
  start(process.execPath, ['scripts/serve-browser-qa.mjs'], {
    env: { ...process.env, RELEASE_QA: 'true' },
  });
  const webEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'production',
    NEXT_TEST_DIST_DIR: '.next-release',
  };
  start(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3200',
    ],
    { cwd: frontend, env: webEnv },
  );
  start('podman', [
    'run',
    '--rm',
    '--name',
    container,
    '--network',
    'host',
    '-v',
    work + ':/qa:ro',
    '-v',
    join(work, 'nginx.conf') + ':/etc/nginx/nginx.conf:ro',
    image,
    'nginx',
    '-g',
    'daemon off;',
  ]);
  const probe = () =>
    new Promise((resolve) => {
      const req = https.get(
        'https://localhost:3443/api/v1/health/live',
        { rejectUnauthorized: false },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => req.destroy());
    });
  for (let n = 0; n < 120; n++) {
    if (await probe()) {
      console.log(
        'HTTPS QA ready: https://localhost:3443. Run frontend pnpm test:release, then Ctrl+C to remove the disposable schema, sessions and certificate.',
      );
      break;
    }
    if (n === 119) throw new Error('QA startup timed out.');
    await delay(500);
  }
} catch {
  console.error(
    'HTTPS rehearsal failed. Check free ports, local DB, production builds, Podman and OpenSSL.',
  );
  await cleanup(1);
}
