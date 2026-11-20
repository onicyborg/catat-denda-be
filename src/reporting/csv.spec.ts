import { describe, it, expect } from 'vitest';
import { csvCell, csv } from './csv.js';
import { period } from './period.js';
describe('CSV boundaries', () => {
  it('neutralizes formula prefixes after invisible characters without changing numeric reversal amounts', () => {
    for (const value of [
      '=1',
      ' +1',
      '-A1',
      '@SUM(A1)',
      '\ttext',
      '\n=1',
      '\u200B=1',
      '＝1',
      '＋1',
    ])
      expect(csvCell(value)).toMatch(/^"'/);
    expect(csvCell(-2000n)).toBe('-2000');
    expect(csvCell(9007199254740993n)).toBe('9007199254740993');
    expect(() => csvCell(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
  it('quotes commas, quotation marks, newlines and unknown cells', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe('""');
    expect(csv(['a'], [])).toBe('\uFEFF"a"\r\n');
  });
  it('uses inclusive WIB dates across leap days and year boundaries', () => {
    const p = period({ from: '2024-02-29', to: '2024-03-01' });
    expect(p.start.toISOString()).toBe('2024-02-28T17:00:00.000Z');
    expect(p.end.toISOString()).toBe('2024-03-01T17:00:00.000Z');
    expect(
      period({ from: '2025-12-31', to: '2026-01-01' }).end.toISOString(),
    ).toBe('2026-01-01T17:00:00.000Z');
  });
});
