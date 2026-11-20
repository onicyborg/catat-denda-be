export type Settlement = 'UNPAID' | 'PARTIAL' | 'PAID';
export function settlement(assigned: bigint, paid: bigint): Settlement {
  return paid === 0n ? 'UNPAID' : paid === assigned ? 'PAID' : 'PARTIAL';
}
export function ledgerTotal(
  entries: ReadonlyArray<{ kind: 'PAYMENT' | 'REVERSAL'; amount: number }>,
) {
  return entries.reduce(
    (sum, entry) =>
      sum + (entry.kind === 'PAYMENT' ? 1n : -1n) * BigInt(entry.amount),
    0n,
  );
}
export function financials(
  status: 'DRAFT' | 'POSTED' | 'VOIDED',
  members: ReadonlyArray<{
    assignedAmount: number | null;
    entries: ReadonlyArray<{ kind: 'PAYMENT' | 'REVERSAL'; amount: number }>;
  }>,
) {
  const preview = members.reduce(
    (sum, member) => sum + BigInt(member.assignedAmount ?? 0),
    0n,
  );
  const paid =
    status === 'POSTED'
      ? members.reduce((sum, member) => sum + ledgerTotal(member.entries), 0n)
      : 0n;
  const assessed = status === 'POSTED' ? preview : 0n;
  return {
    previewAmount: preview.toString(),
    amountsComplete:
      members.length > 0 && members.every((m) => m.assignedAmount !== null),
    assessedAmount: assessed.toString(),
    netPaidAmount: paid.toString(),
    outstandingAmount: (assessed - paid).toString(),
    settlementStatus: status === 'POSTED' ? settlement(assessed, paid) : null,
  };
}
