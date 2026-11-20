import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const rupiah = z.number().int().min(1).max(100000000);
export function aggregate(value: bigint) {
  return value.toString();
}
export function jakartaRange(from: string, to: string) {
  const date = z.iso.date();
  date.parse(from);
  date.parse(to);
  const start = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000);
  if (start >= end)
    throw new BadRequestException('Rentang tanggal tidak valid.');
  return { gte: start, lt: end };
}
