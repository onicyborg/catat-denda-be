import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.url().startsWith('postgresql://'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
});

export function validateEnv(config: Record<string, unknown>) {
  return envSchema.parse(config);
}
