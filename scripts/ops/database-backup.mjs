import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
const magic = Buffer.from('CDENDA01'),
  headerLength = 36,
  tagLength = 16;
const archivePattern = /^catat-denda_\d{8}T\d{6}Z_[a-f0-9]{12}\.dump\.enc$/;
export function cleanDatabaseUrl(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('URL database wajib PostgreSQL.');
  for (const key of url.searchParams.keys())
    if (/password|secret|token|passfile/i.test(key))
      throw new Error('Kredensial URL wajib melalui userinfo, bukan query.');
  for (const key of ['schema', 'pgbouncer', 'connection_limit', 'pool_timeout'])
    url.searchParams.delete(key);
  return url;
}
async function privateFile(path) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid?.() !== 0 && info.uid !== process.getuid?.())
  )
    throw new Error(
      'File rahasia/arsip harus regular, milik operator, mode0600.',
    );
  return info;
}
async function secret(path) {
  await privateFile(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const value = (await handle.readFile()).toString().trim();
    if (Buffer.byteLength(value) < 32 || Buffer.byteLength(value) > 4096)
      throw new Error('Kunci backup minimal32 byte, maksimal4096 byte.');
    return value;
  } finally {
    await handle.close();
  }
}
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw new Error(
      'Direktori backup harus private mode0700 dan bukan symlink.',
    );
}
async function checksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function connection(databaseUrl, work) {
  const folder = await mkdtemp(join(tmpdir(), 'catat-pgpass-'));
  const url = cleanDatabaseUrl(databaseUrl);
  const password = decodeURIComponent(url.password);
  url.password = '';
  const escape = (value) =>
    value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  const passfile = join(folder, 'pgpass');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  await writeFile(
    passfile,
    [
      host,
      url.port || '5432',
      decodeURIComponent(url.pathname.slice(1)),
      decodeURIComponent(url.username),
      password,
    ]
      .map(escape)
      .join(':') + '\n',
    { mode: 0o600 },
  );
  try {
    return await work(url.toString(), {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      PGPASSFILE: passfile,
      PGCONNECT_TIMEOUT: '10',
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
function command(binary, args, env) {
  const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errorText = '';
  child.stderr.on('data', (chunk) => {
    if (errorText.length < 4096) errorText += chunk.toString();
  });
  const completed = new Promise((resolve, reject) => {
    child.once('error', () =>
      reject(new Error('Client PostgreSQL tidak dapat dijalankan.')),
    );
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Client PostgreSQL gagal dengan exit ${code}.`)),
    );
  });
  completed.catch(() => {});
  return { child, completed };
}
export async function backupDatabase({ databaseUrl, keyFile, outputDir }) {
  await directory(outputDir);
  const pass = await secret(keyFile),
    salt = randomBytes(16),
    iv = randomBytes(12),
    header = Buffer.concat([magic, salt, iv]),
    key = scryptSync(pass, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  const createdAt = new Date().toISOString(),
    stamp = createdAt.slice(0, 19).replaceAll('-', '').replaceAll(':', ''),
    name = `catat-denda_${stamp}Z_${randomBytes(6).toString('hex')}.dump.enc`,
    target = join(resolve(outputDir), name),
    part = target + '.part';
  try {
    await writeFile(part, header, { mode: 0o600, flag: 'wx' });
    await connection(databaseUrl, async (url, env) => {
      const { child, completed } = command(
        process.env.PG_DUMP_BIN ?? 'pg_dump',
        ['--format=custom', '--no-owner', '--no-acl', '--dbname', url],
        env,
      );
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(header);
      try {
        await pipeline(
          child.stdout,
          cipher,
          createWriteStream(part, { flags: 'a', mode: 0o600 }),
        );
        await completed;
        await appendFile(part, cipher.getAuthTag());
      } catch (error) {
        child.kill('SIGTERM');
        await completed.catch(() => {});
        throw error;
      }
    });
    const file = await open(part, 'r+');
    await file.sync();
    await file.close();
    await rename(part, target);
    const manifest = {
      format: 'catat-denda-aes256gcm-v1',
      createdAt,
      file: name,
      sha256: await checksum(target),
      bytes: (await lstat(target)).size,
    };
    await writeFile(
      target + '.json',
      JSON.stringify(manifest, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    return {
      archive: target,
      manifest: target + '.json',
      createdAt,
      bytes: manifest.bytes,
      sha256: manifest.sha256,
    };
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  } finally {
    key.fill(0);
  }
}
export async function restoreDatabase({
  databaseUrl,
  keyFile,
  archive,
  confirmDatabase,
}) {
  const url = cleanDatabaseUrl(databaseUrl),
    dbName = decodeURIComponent(url.pathname.slice(1));
  if (!confirmDatabase || confirmDatabase !== dbName)
    throw new Error('Konfirmasi nama database tujuan wajib sama persis.');
  await privateFile(archive);
  await privateFile(archive + '.json');
  const metadata = JSON.parse(await readFile(archive + '.json', 'utf8'));
  if (
    metadata.format !== 'catat-denda-aes256gcm-v1' ||
    metadata.file !== basename(archive) ||
    metadata.sha256 !== (await checksum(archive))
  )
    throw new Error('Checksum atau manifest backup tidak valid.');
  const size = (await lstat(archive)).size;
  if (size < headerLength + tagLength)
    throw new Error('Arsip backup tidak lengkap.');
  const pass = await secret(keyFile),
    handle = await open(archive, 'r'),
    header = Buffer.alloc(headerLength),
    tag = Buffer.alloc(tagLength);
  await handle.read(header, 0, headerLength, 0);
  await handle.read(tag, 0, tagLength, size - tagLength);
  await handle.close();
  if (!header.subarray(0, 8).equals(magic))
    throw new Error('Format backup tidak didukung.');
  const key = scryptSync(pass, header.subarray(8, 24), 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }),
    folder = await mkdtemp(join(tmpdir(), 'catat-restore-')),
    dump = join(folder, 'restore.dump');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      header.subarray(24, 36),
    );
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    // Authenticate the entire archive before any restore command receives plaintext.
    await pipeline(
      createReadStream(archive, {
        start: headerLength,
        end: size - tagLength - 1,
      }),
      decipher,
      createWriteStream(dump, { mode: 0o600, flags: 'wx' }),
    );
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    try {
      const result = await db.query(
        "SELECT count(*)::int AS tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'",
      );
      if (result.rows[0].tables !== 0)
        throw new Error(
          'Restore hanya diizinkan ke database baru yang kosong; database lama tidak ditimpa.',
        );
    } finally {
      await db.end();
    }
    await connection(databaseUrl, async (clean, env) => {
      const { child, completed } = command(
        process.env.PG_RESTORE_BIN ?? 'pg_restore',
        [
          '--exit-on-error',
          '--single-transaction',
          '--no-owner',
          '--no-acl',
          '--dbname',
          clean,
          dump,
        ],
        env,
      );
      child.stdout.resume();
      await completed;
    });
    return {
      restored: true,
      database: dbName,
      backupCreatedAt: metadata.createdAt,
    };
  } finally {
    key.fill(0);
    await rm(folder, { recursive: true, force: true });
  }
}
export async function pruneBackups(
  outputDir,
  { retentionDays = 14, now = Date.now() } = {},
) {
  if (!Number.isInteger(retentionDays) || retentionDays < 14)
    throw new Error('Retensi minimal14 hari.');
  await directory(outputDir);
  const candidates = [];
  for (const name of await readdir(outputDir)) {
    if (!archivePattern.test(name)) continue;
    try {
      const archive = join(outputDir, name);
      await privateFile(archive);
      await privateFile(archive + '.json');
      const meta = JSON.parse(await readFile(archive + '.json', 'utf8'));
      const time = Date.parse(meta.createdAt);
      if (
        meta.file !== name ||
        meta.format !== 'catat-denda-aes256gcm-v1' ||
        !Number.isFinite(time) ||
        meta.sha256 !== (await checksum(archive))
      )
        continue;
      candidates.push({ archive, time });
    } catch {}
  }
  candidates.sort((a, b) => b.time - a.time);
  const removed = [];
  for (const item of candidates.slice(14)) {
    if (item.time >= now - retentionDays * 86400000) continue;
    await rm(item.archive);
    await rm(item.archive + '.json');
    removed.push(basename(item.archive));
  }
  return { removed, retained: candidates.length - removed.length };
}
