import { validateEnv } from './env.js';
const valid = {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  SESSION_SECRET: 'test-only-secret-at-least-32-characters',
};
describe('Environment security boundaries', () => {
  it('requires PostgreSQL and a plain HTTP origin', () => {
    expect(() =>
      validateEnv({ ...valid, DATABASE_URL: 'https://localhost/test' }),
    ).toThrow();
    for (const APP_BASE_URL of [
      'ftp://example.test',
      'https://example.test/path',
      'https://user:pass@example.test',
      'https://example.test?token=secret',
    ]) {
      expect(() => validateEnv({ ...valid, APP_BASE_URL })).toThrow();
    }
    expect(validateEnv(valid).APP_BASE_URL).toBe('http://localhost:3000');
  });
  it('rejects the example secret on production', () => {
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        SESSION_SECRET: 'replace-with-random-secret-at-least-32-characters',
      }),
    ).toThrow();
  });
  it('requires HTTPS in production and explicit loopback proxy trust', () => {
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_BASE_URL: 'http://localhost:3000',
      }),
    ).toThrow();
    expect(
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://qa.example.test',
      }).TRUST_PROXY_LOOPBACK,
    ).toBe(false);
    expect(
      validateEnv({ ...valid, TRUST_PROXY_LOOPBACK: 'true' })
        .TRUST_PROXY_LOOPBACK,
    ).toBe(true);
    expect(() =>
      validateEnv({ ...valid, TRUST_PROXY_LOOPBACK: 'anything' }),
    ).toThrow();
  });
});
