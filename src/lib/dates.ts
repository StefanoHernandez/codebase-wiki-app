/** Local calendar date as YYYY-MM-DD (human log headings, not UTC). */
export function todayLocal(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** UTC instant for `verified.at`: ISO 8601 with Z and no fractional seconds. */
export function verifiedAtUtc(d = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
