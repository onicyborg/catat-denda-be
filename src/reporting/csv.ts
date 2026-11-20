export type CsvCell = string | number | bigint | null;
export function csvCell(value: CsvCell): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new Error('CSV integer out of range');
    return value.toString();
  }
  let text = value ?? '';
  const leading = text.match(/^[\p{White_Space}\p{Cc}\p{Cf}]*/u)?.[0] ?? '';
  if (
    /^[=+\-@＝＋－＠]/u.test(text.slice(leading.length)) ||
    /[\p{Cc}\p{Cf}]/u.test(leading)
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csv(headers: string[], rows: CsvCell[][]) {
  return (
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') +
    '\r\n'
  );
}
export const fineHeaders = [
  'case_code',
  'occurred_at_wib',
  'case_status',
  'violation_code',
  'violation_name_snapshot',
  'description',
  'employee_code',
  'employee_name_snapshot',
  'assigned_amount_idr',
  'net_paid_idr',
  'outstanding_idr',
  'settlement_status',
  'created_at_wib',
];
export const paymentHeaders = [
  'entry_id',
  'case_code',
  'employee_name',
  'kind',
  'amount_idr',
  'signed_amount_idr',
  'method',
  'effective_at_wib',
  'recorded_at_wib',
  'original_payment_id',
  'note',
  'recorded_by',
];
