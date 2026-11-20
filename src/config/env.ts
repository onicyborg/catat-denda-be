import { z } from 'zod';
export function validateEnv(config: Record<string, unknown>) {
  return z
    .object({
      DATABASE_URL: z.url(),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      APP_BASE_URL: z.url().default('http://localhost:3000'),
      NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),
      SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
      SESSION_SECRET: z.string().min(32),
    })
    .parse(config);
}
