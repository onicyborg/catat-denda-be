import { UnprocessableEntityException } from '@nestjs/common';
import type { PeriodQuery } from './dto.js';
export function period(q: PeriodQuery) {
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const from = q.from ?? today.slice(0, 7) + '-01';
  const last = new Date(
    Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const to = q.to ?? last;
  if (from > to)
    throw new UnprocessableEntityException(
      'Tanggal awal harus sebelum tanggal akhir.',
    );
  const start = new Date(`${from}T00:00:00+07:00`),
    end = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400000);
  return { from, to, start, end };
}
export const wibCsv = (date: Date | null) =>
  date
    ? new Date(date.getTime() + 7 * 3600000)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '+07:00')
    : '';
