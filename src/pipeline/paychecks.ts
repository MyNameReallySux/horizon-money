import type { Paycheck, PaySchedule } from '../data/contract.ts';
import { cents, isFiniteNumber, recordsAt, type Warn } from './raw.ts';

const DAY_MS = 86_400_000;
const PERIOD_DAYS = 14;

/** A received paycheck deposit: ISO date and positive amount. */
export interface Deposit {
  date: string;
  amount: number;
}

/** Days a deposit may land before or after the expected date and still match it. */
export const MATCH_WINDOW_DAYS = 3;

const dayNumber = (iso: string): number => Math.floor(Date.parse(iso.slice(0, 10)) / DAY_MS);
const isoOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Reads GetTransactions output filtered to paychecks; non-positive or malformed rows are dropped. */
export function mapDeposits(raw: unknown, warn: Warn): Deposit[] {
  const out: Deposit[] = [];
  let skipped = 0;
  for (const t of recordsAt(raw, ['transactions'], 'paychecks.json')) {
    if (
      typeof t.date !== 'string' ||
      Number.isNaN(Date.parse(t.date)) ||
      !isFiniteNumber(t.amount) ||
      t.amount <= 0
    ) {
      skipped++;
      continue;
    }
    out.push({ date: t.date.slice(0, 10), amount: t.amount });
  }
  if (skipped > 0) warn(`skipped ${skipped} paycheck transaction(s) with a bad date or non-positive amount`);
  return out;
}

/**
 * Builds the paycheck ledger: every 14th day aligned to the anchor, from the earliest deposit's
 * window (or the anchor itself when there are no deposits) through `today`, each matched to the closest unused deposit within
 * {@link MATCH_WINDOW_DAYS}. Unmatched past dates keep null received fields; future dates are
 * omitted. A deposit's own amount is kept, so partial paychecks show as received.
 */
export function buildPaychecks(schedule: PaySchedule, deposits: Deposit[], today: string): Paycheck[] {
  const anchor = dayNumber(schedule.anchorDate);
  const end = dayNumber(today);
  const days = deposits.map((d) => ({ day: dayNumber(d.date), amount: d.amount, used: false }));
  const start = days.length > 0 ? Math.min(...days.map((d) => d.day)) - MATCH_WINDOW_DAYS : anchor;

  const first = anchor + Math.ceil((start - anchor) / PERIOD_DAYS) * PERIOD_DAYS;
  const out: Paycheck[] = [];
  for (let day = first; day <= end; day += PERIOD_DAYS) {
    let best: (typeof days)[number] | undefined;
    for (const d of days) {
      if (d.used || Math.abs(d.day - day) > MATCH_WINDOW_DAYS) continue;
      if (best === undefined || Math.abs(d.day - day) < Math.abs(best.day - day)) best = d;
    }
    if (best) best.used = true;
    out.push({
      expectedDate: isoOf(day),
      expectedAmount: schedule.expectedAmount,
      receivedDate: best ? isoOf(best.day) : null,
      receivedAmount: best ? cents(best.amount) : null,
    });
  }
  return out;
}

/** A pay stub reduced to what reconciliation needs. */
export interface Stub {
  date: string;
  netPay: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Biweekly schedule inferred from stubs when manual.json has none: anchored on the latest stub,
 * paying the median take-home so one bonus or short check does not skew the expectation.
 */
export function deriveSchedule(stubs: Stub[]): PaySchedule | undefined {
  if (stubs.length === 0) return undefined;
  const latest = stubs.reduce((a, b) => (b.date > a.date ? b : a));
  return {
    cadence: 'biweekly',
    anchorDate: latest.date,
    expectedAmount: cents(median(stubs.map((s) => s.netPay))),
  };
}

interface Item {
  day: number;
  amount: number;
  used: boolean;
}

const closestUnused = (items: Item[], day: number): Item | undefined => {
  let best: Item | undefined;
  for (const it of items) {
    if (it.used || Math.abs(it.day - day) > MATCH_WINDOW_DAYS) continue;
    if (best === undefined || Math.abs(it.day - day) < Math.abs(best.day - day)) best = it;
  }
  if (best) best.used = true;
  return best;
};

/**
 * Reconciles pay stubs with bank deposits against the biweekly schedule. Every expected date from
 * the earliest stub or deposit (minus the match window) through `today` is `paid` (stub and
 * deposit), `stub-only`, `deposit-only` or `missed`. Whatever matches no expected date is kept as
 * `off-cycle`, a stub and a deposit within the match window of each other forming one entry;
 * its `expectedDate` is its own date and `expectedAmount` its own amount. Sorted by `expectedDate`.
 */
export function buildPaycheckLedger(
  schedule: PaySchedule,
  stubs: Stub[],
  deposits: Deposit[],
  today: string,
): Paycheck[] {
  const anchor = dayNumber(schedule.anchorDate);
  const end = dayNumber(today);
  const stubItems: Item[] = stubs.map((s) => ({ day: dayNumber(s.date), amount: s.netPay, used: false }));
  const depositItems: Item[] = deposits.map((d) => ({ day: dayNumber(d.date), amount: d.amount, used: false }));
  const all = [...stubItems, ...depositItems];
  const start = all.length > 0 ? Math.min(...all.map((i) => i.day)) - MATCH_WINDOW_DAYS : anchor;

  const out: Paycheck[] = [];
  const first = anchor + Math.ceil((start - anchor) / PERIOD_DAYS) * PERIOD_DAYS;
  for (let day = first; day <= end; day += PERIOD_DAYS) {
    const stub = closestUnused(stubItems, day);
    const deposit = closestUnused(depositItems, day);
    out.push({
      expectedDate: isoOf(day),
      expectedAmount: schedule.expectedAmount,
      receivedDate: deposit ? isoOf(deposit.day) : null,
      receivedAmount: deposit ? cents(deposit.amount) : null,
      status: stub && deposit ? 'paid' : stub ? 'stub-only' : deposit ? 'deposit-only' : 'missed',
      stubNetPay: stub ? cents(stub.amount) : null,
    });
  }

  for (const stub of stubItems.filter((s) => !s.used)) {
    const deposit = closestUnused(depositItems, stub.day);
    out.push({
      expectedDate: isoOf(stub.day),
      expectedAmount: cents(stub.amount),
      receivedDate: deposit ? isoOf(deposit.day) : null,
      receivedAmount: deposit ? cents(deposit.amount) : null,
      status: 'off-cycle',
      stubNetPay: cents(stub.amount),
    });
  }
  for (const deposit of depositItems.filter((d) => !d.used)) {
    out.push({
      expectedDate: isoOf(deposit.day),
      expectedAmount: cents(deposit.amount),
      receivedDate: isoOf(deposit.day),
      receivedAmount: cents(deposit.amount),
      status: 'off-cycle',
      stubNetPay: null,
    });
  }
  return out.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
}
