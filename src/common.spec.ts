import { aggregate, jakartaRange, pagination, rupiah } from './common.js';
describe('Batas nominal, pagination dan tanggal WIB', () => {
  it('menolak pecahan dan nominal di luar batas', () => {
    for (const amount of [0, -1, 1.5, 100000001])
      expect(() => rupiah.parse(amount)).toThrow();
    expect(rupiah.parse(100000000)).toBe(100000000);
  });
  it('mempertahankan aggregate besar tanpa kehilangan presisi', () => {
    expect(aggregate(9007199254740993n)).toBe('9007199254740993');
  });
  it('mengonversi hari terakhir tahun ke interval setengah terbuka UTC', () => {
    const range = jakartaRange('2026-12-31', '2026-12-31');
    expect(range.gte.toISOString()).toBe('2026-12-30T17:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(() => jakartaRange('2026-02-30', '2026-03-01')).toThrow();
    expect(() => jakartaRange('2026-12-31', '2026-12-30')).toThrow();
  });
  it('membatasi pagination', () => {
    expect(pagination.parse({})).toEqual({ page: 1, limit: 20 });
    expect(() => pagination.parse({ limit: 101 })).toThrow();
  });
});
