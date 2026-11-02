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

/** Days an item may sit from its nearest slot and still count as that slot's payment. */
export const SLOT_WINDOW_DAYS = 6;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** Gap range, in days, between consecutive stubs that still counts as regular biweekly pay. */
const REGULAR_GAP = { min: 10, max: 18 };
const MIN_REGULAR_RUN = 3;

/** Days of the newest stubs whose consecutive gaps are all regular, newest first. */
function recentRegularRun(days: number[]): number[] {
  const desc = [...new Set(days)].sort((a, b) => b - a);
  const run = desc.slice(0, 1);
  for (const d of desc.slice(1)) {
    const gap = run[run.length - 1]! - d;
    if (gap < REGULAR_GAP.min || gap > REGULAR_GAP.max) break;
    run.push(d);
  }
  return run;
}

/**
 * Biweekly schedule inferred from stubs when manual.json has none. Pay often lands days after the
 * official date and irregular stretches precede the current routine, so anchoring on the latest
 * stub or fitting every stub drifts. Instead the phase (one of 14 offsets) is fitted on the most
 * recent run of stubs spaced 10-18 days apart: the phase most of them hit exactly wins, smallest
 * total distance breaking ties. Fewer than {@link MIN_REGULAR_RUN} such stubs falls back to all
 * stubs, with a warning. The anchor is the slot at or before the latest stub; the grid then
 * projects backwards over the whole history. Expects the median take-home of all stubs so one
 * bonus or short check does not skew it.
 */
export function deriveSchedule(stubs: Stub[], warn?: Warn): PaySchedule | undefined {
  if (stubs.length === 0) return undefined;
  const days = stubs.map((s) => dayNumber(s.date));
  let fit = recentRegularRun(days);
  if (fit.length < MIN_REGULAR_RUN) {
    warn?.('fewer than 3 recent regular pay stubs; pay schedule fitted on all stubs');
    fit = days;
  }
  let best = { phase: 0, hits: -1, total: Infinity };
  for (let phase = 0; phase < PERIOD_DAYS; phase++) {
    let hits = 0;
    let total = 0;
    for (const d of fit) {
      const off = mod(d - phase, PERIOD_DAYS);
      const dist = Math.min(off, PERIOD_DAYS - off);
      if (dist === 0) hits++;
      total += dist;
    }
    if (hits > best.hits || (hits === best.hits && total < best.total)) best = { phase, hits, total };
  }
  const latest = Math.max(...days);
  return {
    cadence: 'biweekly',
    anchorDate: isoOf(latest - mod(latest - best.phase, PERIOD_DAYS)),
    expectedAmount: cents(median(stubs.map((s) => s.netPay))),
  };
}

interface Item {
  day: number;
  amount: number;
  slot: number | undefined;
}

/**
 * Gives each item its nearest slot when within {@link SLOT_WINDOW_DAYS}; where several items want
 * one slot the closest wins (earlier date on a tie) and the rest get no slot. Returns slot -> item.
 */
function assignSlots(items: Item[], slots: number[]): Map<number, Item> {
  const wants = items
    .map((item) => {
      let nearest: number | undefined;
      for (const s of slots) {
        if (nearest === undefined || Math.abs(item.day - s) < Math.abs(item.day - nearest)) nearest = s;
      }
      return { item, slot: nearest };
    })
    .filter((w): w is { item: Item; slot: number } => w.slot !== undefined && Math.abs(w.item.day - w.slot) <= SLOT_WINDOW_DAYS)
    .sort((a, b) => Math.abs(a.item.day - a.slot) - Math.abs(b.item.day - b.slot) || a.item.day - b.item.day);
  const taken = new Map<number, Item>();
  for (const { item, slot } of wants) {
    if (taken.has(slot)) continue;
    taken.set(slot, item);
    item.slot = slot;
  }
  return taken;
}

/**
 * Reconciles pay stubs with bank deposits against the biweekly schedule. Slots run every 14 days
 * from the first at or after (earliest stub or deposit minus {@link SLOT_WINDOW_DAYS}) through
 * `today`. Stubs and deposits are assigned to slots independently, so a deposit that lags its stub
 * still lands in the same slot: `paid` (both), `stub-only`, `deposit-only` or `missed` (neither).
 * What gets no slot is kept as `off-cycle`, a stub and deposit within {@link MATCH_WINDOW_DAYS}
 * of each other forming one entry; its `expectedDate` and `expectedAmount` are its own. Sorted by
 * `expectedDate`.
 */
export function buildPaycheckLedger(
  schedule: PaySchedule,
  stubs: Stub[],
  deposits: Deposit[],
  today: string,
): Paycheck[] {
  const anchor = dayNumber(schedule.anchorDate);
  const end = dayNumber(today);
  const stubItems: Item[] = stubs.map((s) => ({ day: dayNumber(s.date), amount: s.netPay, slot: undefined }));
  const depositItems: Item[] = deposits.map((d) => ({ day: dayNumber(d.date), amount: d.amount, slot: undefined }));
  const all = [...stubItems, ...depositItems];
  const start = all.length > 0 ? Math.min(...all.map((i) => i.day)) - SLOT_WINDOW_DAYS : anchor;

  const slots: number[] = [];
  for (let day = anchor + Math.ceil((start - anchor) / PERIOD_DAYS) * PERIOD_DAYS; day <= end; day += PERIOD_DAYS) {
    slots.push(day);
  }
  const stubAt = assignSlots(stubItems, slots);
  const depositAt = assignSlots(depositItems, slots);

  const out: Paycheck[] = slots.map((slot) => {
    const stub = stubAt.get(slot);
    const deposit = depositAt.get(slot);
    const paidDay = deposit?.day ?? stub?.day;
    const row: Paycheck = {
      expectedDate: isoOf(slot),
      expectedAmount: schedule.expectedAmount,
      receivedDate: deposit ? isoOf(deposit.day) : null,
      receivedAmount: deposit ? cents(deposit.amount) : null,
      status: stub && deposit ? 'paid' : stub ? 'stub-only' : deposit ? 'deposit-only' : 'missed',
      stubNetPay: stub ? cents(stub.amount) : null,
    };
    if (paidDay !== undefined) row.daysLate = paidDay - slot;
    return row;
  });

  const freeDeposits = depositItems.filter((d) => d.slot === undefined);
  for (const stub of stubItems.filter((s) => s.slot === undefined)) {
    let pair: Item | undefined;
    for (const d of freeDeposits) {
      if (d.slot !== undefined || Math.abs(d.day - stub.day) > MATCH_WINDOW_DAYS) continue;
      if (pair === undefined || Math.abs(d.day - stub.day) < Math.abs(pair.day - stub.day)) pair = d;
    }
    if (pair) pair.slot = -1;
    out.push({
      expectedDate: isoOf(stub.day),
      expectedAmount: cents(stub.amount),
      receivedDate: pair ? isoOf(pair.day) : null,
      receivedAmount: pair ? cents(pair.amount) : null,
      status: 'off-cycle',
      stubNetPay: cents(stub.amount),
    });
  }
  for (const deposit of freeDeposits.filter((d) => d.slot === undefined)) {
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
