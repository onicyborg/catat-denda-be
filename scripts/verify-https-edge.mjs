import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

// Fixed loopback target: never disable certificate checks for an external host.
function call(path, { headers = {}, method = 'GET', data } = {}) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : undefined;
    const req = https.request(
      {
        hostname: 'localhost',
        port: 3443,
        path,
        method,
        rejectUnauthorized: false,
        headers: {
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
    req.end(body);
  });
}
const response = await call(
  '/api/v1/reports/summary?secret=qa-log-redaction-sentinel',
);
assert.equal(response.status, 401);
assert.equal(response.headers['cache-control'], 'no-store');
assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
assert(!response.body.includes('stack'));
assert.equal((await call('/api/v1/health/live')).status, 200);
assert.equal((await call('/api/v1/health/ready')).status, 404);
assert.equal(
  (
    await call('/api/v1/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://foreign.example.test' },
      data: {},
    })
  ).status,
  403,
);
await assert.rejects(
  call('/api/v1/auth/me', {
    headers: {
      Host: 'forged.example.test',
      'X-Forwarded-Host': 'localhost:3443',
    },
  }),
);
const statuses = [];
for (let n = 1; n <= 6; n++) {
  const result = await call('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      Origin: 'https://localhost:3443',
      'X-Forwarded-For': `198.51.100.${n}`,
    },
    data: {
      username: 'nonexistent-' + randomBytes(6).toString('hex'),
      password: 'incorrect-QA-only-password',
    },
  });
  statuses.push(result.status);
}
assert(
  statuses.includes(429),
  'Forged XFF must not bypass the shared client login throttle.',
);
assert(statuses.every((status) => status === 401 || status === 429));
const redirect = await new Promise((resolve, reject) => {
  http
    .get('http://localhost:3080/login', (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    })
    .on('error', reject);
});
assert.deepEqual(redirect, {
  status: 308,
  location: 'https://localhost:3443/login',
});
console.log(
  JSON.stringify({
    httpsEdge: 'PASS',
    redirect: true,
    privateNoStore: true,
    forgedHostRejected: true,
    originRejected: true,
    forgedForwardedIpCannotBypassThrottle: true,
    loginStatuses: statuses,
  }),
);
