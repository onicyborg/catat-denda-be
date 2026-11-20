import { describe, it, expect } from 'vitest';
import { financials, ledgerTotal } from './calculations.js';
describe('fine balances', () => {
  it('sums allocations rather than multiplying a rate', () => {
    for (const amounts of [
      [5000],
      [5000, 5000],
      [5000, 5000, 5000, 5000],
      [3000, 7000],
    ]) {
      const members = amounts.map((assignedAmount) => ({
        assignedAmount,
        entries: [],
      }));
      expect(financials('POSTED', members).assessedAmount).toBe(
        String(amounts.reduce((a, b) => a + b, 0)),
      );
      expect(financials('DRAFT', members).outstandingAmount).toBe('0');
      expect(financials('VOIDED', members).settlementStatus).toBe(null);
    }
  });
  it('derives settlement from net ledger, including reversals', () => {
    const entries = [
      { kind: 'PAYMENT' as const, amount: 5000 },
      { kind: 'REVERSAL' as const, amount: 2000 },
    ];
    expect(ledgerTotal(entries)).toBe(3000n);
    expect(
      financials('POSTED', [{ assignedAmount: 5000, entries }]),
    ).toMatchObject({
      netPaidAmount: '3000',
      outstandingAmount: '2000',
      settlementStatus: 'PARTIAL',
    });
    expect(
      financials('POSTED', [{ assignedAmount: 5000, entries: [entries[0]] }])
        .settlementStatus,
    ).toBe('PAID');
  });
  it('retains incomplete preview without counting draft debt', () =>
    expect(
      financials('DRAFT', [
        { assignedAmount: null, entries: [] },
        { assignedAmount: 5000, entries: [] },
      ]),
    ).toMatchObject({
      previewAmount: '5000',
      amountsComplete: false,
      assessedAmount: '0',
    }));
});
