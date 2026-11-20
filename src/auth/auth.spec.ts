import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SessionGuard } from './auth.js';

describe('Separate frontend and API origins', () => {
  function check(
    host: string,
    origin: string,
    apiUrl?: string,
    path = '/api/v1/auth/login',
  ) {
    const config = new ConfigService({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://app.example.test',
      ...(apiUrl ? { API_PUBLIC_URL: apiUrl } : {}),
    });
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new SessionGuard({} as PrismaService, config, reflector);
    const request = {
      method: path.endsWith('/live') ? 'GET' : 'POST',
      path,
      headers: { host, origin },
    };
    return guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => function login() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext);
  }
  it('accepts the API host with the frontend Origin', async () => {
    await expect(
      check(
        'api.example.test',
        'https://app.example.test',
        'https://api.example.test',
      ),
    ).resolves.toBe(true);
  });
  it('rejects an API Origin and unrecognized Host', async () => {
    await expect(
      check(
        'api.example.test',
        'https://api.example.test',
        'https://api.example.test',
      ),
    ).rejects.toThrow('Asal');
    await expect(
      check(
        'attacker.example.test',
        'https://app.example.test',
        'https://api.example.test',
      ),
    ).rejects.toThrow('Host');
  });
  it('preserves same-host installations and internal liveness probes', async () => {
    await expect(
      check('app.example.test', 'https://app.example.test'),
    ).resolves.toBe(true);
    await expect(
      check(
        '127.0.0.1:3001',
        '',
        'https://api.example.test',
        '/api/v1/health/live',
      ),
    ).resolves.toBe(true);
  });
});
