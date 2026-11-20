import { z } from 'zod';
export function validateEnv(config: Record<string, unknown>) {
  return z
    .object({
      DATABASE_URL: z
        .url()
        .refine(
          (value) =>
            ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
          'DATABASE_URL harus PostgreSQL.',
        ),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      APP_BASE_URL: z
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash
          );
        }, 'APP_BASE_URL harus origin HTTP/HTTPS tanpa path atau kredensial.')
        .default('http://localhost:3000'),
      NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),
      SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
      SESSION_SECRET: z.string().min(32),
    })
    .refine(
      (value) =>
        value.NODE_ENV !== 'production' ||
        !value.SESSION_SECRET.startsWith('replace-with-'),
      'Ganti placeholder SESSION_SECRET sebelum production.',
    )
    .parse(config);
}
