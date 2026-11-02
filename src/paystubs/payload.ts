import { isIsoDate } from '../data/manual.ts';
import type { PaystubEntry } from './index.ts';

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** Returns the `responseBody` of a portal `{"JSONOUT": {...}}` envelope, or the input when unwrapped. */
export function unwrapPortal(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined;
  const out = isRecord(payload.JSONOUT) ? payload.JSONOUT : payload;
  return isRecord(out.responseBody) ? out.responseBody : out;
}

/** Reads the year list from a `payStubYears` response; malformed rows are dropped. Newest first.
 * Null when the body has no `payStubYears` array, which is how a portal error envelope looks. */
export function parseYears(payload: unknown): string[] | null {
  const body = unwrapPortal(payload);
  if (!isRecord(body) || !Array.isArray(body.payStubYears)) return null;
  const rows: unknown[] = body.payStubYears;
  const years = rows
    .map((r) => (isRecord(r) ? r.year : undefined))
    .filter((y): y is string => typeof y === 'string' && /^\d{4}$/.test(y));
  return [...new Set(years)].sort().reverse();
}

/** Accepts `MM/DD/YYYY` or an ISO date (optionally with a time); returns `YYYY-MM-DD` or null. */
export function normalizePayDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const iso = us
    ? `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`
    : /^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(s)
      ? s.slice(0, 10)
      : null;
  return iso !== null && isIsoDate(iso) ? iso : null;
}

/** Parses an amount such as `$1,234.50` or `-12`; returns null when it is not a finite number. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100) / 100;
}

/**
 * Reads the stub list from a `payStubInfo` response. Rows without a usable date, amount or
 * voucher are counted in `skipped` rather than thrown, so one odd row does not lose a year.
 * `recognised` is false when the body has no `payStubInfo` array (a portal error envelope), which
 * must not be mistaken for a year with no stubs.
 */
export function parseStubs(payload: unknown): { stubs: PaystubEntry[]; skipped: number; recognised: boolean } {
  const body = unwrapPortal(payload);
  if (!isRecord(body) || !Array.isArray(body.payStubInfo)) return { stubs: [], skipped: 0, recognised: false };
  const rows: unknown[] = body.payStubInfo;
  const stubs: PaystubEntry[] = [];
  let skipped = 0;
  for (const r of rows) {
    const payDate = isRecord(r) ? normalizePayDate(r.payDate) : null;
    const netPay = isRecord(r) ? parseAmount(r.netPay) : null;
    const voucher = isRecord(r) && typeof r.voucherNumber === 'string' ? r.voucherNumber.trim() : '';
    if (!isRecord(r) || payDate === null || netPay === null || voucher === '') {
      skipped++;
      continue;
    }
    const check = typeof r.checkNumber === 'string' ? r.checkNumber.trim() : '';
    stubs.push({ payDate, netPay, checkNumber: check, voucherNumber: voucher, file: null, source: 'oasis' });
  }
  return { stubs, skipped, recognised: true };
}

/**
 * Decodes the `response` field of a `getPayStubReport` reply. Returns null unless it is
 * base64 whose bytes start with `%PDF`, so an error page never lands on disk as a stub.
 */
export function decodePdf(payload: unknown): Uint8Array | null {
  if (!isRecord(payload) || typeof payload.response !== 'string') return null;
  let binary: string;
  try {
    binary = atob(payload.response);
  } catch {
    return null;
  }
  if (!binary.startsWith('%PDF')) return null;
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
