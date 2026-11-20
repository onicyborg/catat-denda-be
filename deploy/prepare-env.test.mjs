import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('separates owner and seed secrets from runtime and preserves role credentials', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'catat-deploy-test-'));
  try {
    writeFileSync(
      join(cwd, '.env.next'),
      [
        'DATABASE_URL=postgresql://owner:owner-password@localhost/db',
        'MIGRATION_DATABASE_URL=postgresql://owner:direct-password@localhost/db',
        'SESSION_SECRET=' + 'a'.repeat(64),
        'SEED_ADMIN_PASSWORD=seed-password',
        'SSH_PASSWORD=must-not-leak',
        'APP_BASE_URL=https://old.example.test',
      ].join('\n'),
    );
    const run = () =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL('./prepare-env.mjs', import.meta.url)),
          'api.example.test',
          'https://app.example.test',
        ],
        { cwd },
      );
    run();
    const runtime = readFileSync(join(cwd, '.env.runtime.next'), 'utf8');
    assert.match(runtime, /APP_BASE_URL=https:\/\/app.example.test/);
    assert.match(runtime, /API_PUBLIC_URL=https:\/\/api.example.test/);
    assert.match(runtime, /DATABASE_URL=postgresql:\/\/catat_denda_runtime:/);
    assert.doesNotMatch(
      runtime,
      /owner-password|direct-password|SEED_ADMIN|SSH_PASSWORD|must-not-leak/,
    );
    assert.equal(statSync(join(cwd, '.env.runtime.next')).mode & 0o777, 0o600);
    const credentials = readFileSync(join(cwd, '.db-roles.json'), 'utf8');
    run();
    assert.equal(
      readFileSync(join(cwd, '.db-roles.json'), 'utf8'),
      credentials,
    );
    assert.match(
      readFileSync(join(cwd, '.env.admin'), 'utf8'),
      /direct-password/,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
