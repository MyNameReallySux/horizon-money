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
