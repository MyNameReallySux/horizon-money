import { isIsoDate } from '../data/manual.ts';

/** Version of `<dataDir>/paystubs/index.json`; `isPaystubIndex` rejects other versions. */
export const PAYSTUB_INDEX_VERSION = 1;

/** One pay stub listed by the employee portal. */
export interface PaystubEntry {
  /** ISO date `YYYY-MM-DD`. */
  payDate: string;
  /** Take-home dollars. */
  netPay: number;
  checkNumber: string;
  /** Portal-unique id for the stub; the dedupe key. */
  voucherNumber: string;
  /** PDF path relative to the paystubs folder (`<yyyy>/<name>.pdf`), null when not downloaded. */
  file: string | null;
  source: 'oasis';
  /** ISO first day of the pay period, read from the PDF by `pnpm paystubs:periods`. */
  periodStart?: string;
  /** ISO last day of the pay period; places the stub on its true biweekly slot. */
  periodEnd?: string;
}

/** The contents of `<dataDir>/paystubs/index.json`. */
export interface PaystubIndex {
  version: typeof PAYSTUB_INDEX_VERSION;
  /** ISO 8601 timestamp of the last write. */
  updatedAt: string;
  stubs: PaystubEntry[];
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/** `<yyyy>/<name>.pdf` only, so an edited index cannot point a reader outside the paystubs folder. */
const FILE_PATTERN = /^\d{4}\/[A-Za-z0-9_.-]+\.pdf$/;

function isPaystubEntry(x: unknown): x is PaystubEntry {
  return (
    isRecord(x) &&
    isIsoDate(x.payDate) &&
    typeof x.netPay === 'number' &&
    Number.isFinite(x.netPay) &&
    typeof x.checkNumber === 'string' &&
    typeof x.voucherNumber === 'string' &&
    x.voucherNumber !== '' &&
    (x.file === null || (typeof x.file === 'string' && FILE_PATTERN.test(x.file))) &&
    x.source === 'oasis' &&
    (x.periodStart === undefined || isIsoDate(x.periodStart)) &&
    (x.periodEnd === undefined || isIsoDate(x.periodEnd))
  );
}

/** Runtime guard for `paystubs/index.json`: version, timestamp and every entry's fields. */
export function isPaystubIndex(x: unknown): x is PaystubIndex {
  return (
    isRecord(x) &&
    x.version === PAYSTUB_INDEX_VERSION &&
    typeof x.updatedAt === 'string' &&
    Array.isArray(x.stubs) &&
    x.stubs.every(isPaystubEntry)
  );
}

/**
 * Merges freshly listed stubs into the existing ones, deduped by voucher number and sorted by
 * pay date. The incoming metadata wins, but a stub already downloaded keeps its file and pay period
 * when the incoming entry has none (a skipped or failed fetch must not forget a PDF on disk).
 */
export function mergeIndex(existing: PaystubEntry[], incoming: PaystubEntry[]): PaystubEntry[] {
  const byVoucher = new Map<string, PaystubEntry>();
  for (const e of existing) byVoucher.set(e.voucherNumber, e);
  for (const e of incoming) {
    const prior = byVoucher.get(e.voucherNumber);
    const merged: PaystubEntry = { ...e, file: e.file ?? prior?.file ?? null };
    const periodStart = e.periodStart ?? prior?.periodStart;
    const periodEnd = e.periodEnd ?? prior?.periodEnd;
    if (periodStart !== undefined) merged.periodStart = periodStart;
    if (periodEnd !== undefined) merged.periodEnd = periodEnd;
    byVoucher.set(e.voucherNumber, merged);
  }
  return [...byVoucher.values()].sort(
    (a, b) => a.payDate.localeCompare(b.payDate) || a.voucherNumber.localeCompare(b.voucherNumber),
  );
}

/**
 * Target path of a stub's PDF relative to the paystubs folder. The voucher comes from a remote
 * response and ends up in a path, so every character outside `[A-Za-z0-9-]` (the underscore
 * included) becomes `_XX` per UTF-8 byte. That keeps distinct vouchers on distinct files, which
 * stripping would not: `AB/1` and `AB1` must not share a PDF.
 */
export function stubFileName(payDate: string, voucherNumber: string): string {
  const safe = Array.from(voucherNumber, (ch) =>
    /[A-Za-z0-9-]/.test(ch)
      ? ch
      : Array.from(new TextEncoder().encode(ch), (b) => `_${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''),
  ).join('');
  return `${payDate.slice(0, 4)}/${payDate}_${safe === '' ? '_none' : safe}.pdf`;
}
