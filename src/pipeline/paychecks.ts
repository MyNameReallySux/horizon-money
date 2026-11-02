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
  /** ISO last day of the stub's pay period, when read from its PDF. */
  periodEnd?: string;
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

interface PeriodSegment {
  /** First pay period end of the run; later ends follow every 14 days. */
  first: number;
  /** Typical days between a period end and its pay date. */
  offset: number;
}

/**
 * Splits stubs that carry a pay period into runs whose period ends share one 14-day grid. A gap
 * between consecutive period ends that is not a multiple of 14 days is a phase shift and starts a
 * new run. Each run's pay-date offset is the median of (pay date - period end).
 */
function periodSegments(stubs: Stub[]): PeriodSegment[] {
  const dated = stubs
    .filter((s): s is Stub & { periodEnd: string } => s.periodEnd !== undefined)
    .map((s) => ({ end: dayNumber(s.periodEnd), pay: dayNumber(s.date) }))
    .sort((a, b) => a.end - b.end);
  const runs: (typeof dated)[] = [];
  for (const item of dated) {
    const run = runs[runs.length - 1];
    if (run && mod(item.end - run[run.length - 1]!.end, PERIOD_DAYS) === 0) run.push(item);
    else runs.push([item]);
  }
  return runs.map((run) => ({ first: run[0]!.end, offset: Math.round(median(run.map((r) => r.pay - r.end))) }));
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
 *
 * When any stub has a `periodEnd`, slots from the first period on come from one grid per run of
 * stubs whose period ends share a 14-day phase (see {@link periodSegments}) instead of the single
 * anchor, so a schedule that shifted mid-history keeps every stub on a slot. A slot is a period
 * end plus the run's typical pay offset; a stub with a period takes its slot exactly when its pay
 * date is within {@link SLOT_WINDOW_DAYS} of it (the closest wins a clash). Other stubs and
 * deposits match the nearest free slot as before, and the anchor grid still covers dates before
 * the first period.
 */
export function buildPaycheckLedger(
  schedule: PaySchedule,
  stubs: Stub[],
  deposits: Deposit[],
  today: string,
): Paycheck[] {
  const anchor = dayNumber(schedule.anchorDate);
  const todayDay = dayNumber(today);
  const stubItems: Item[] = stubs.map((s) => ({ day: dayNumber(s.date), amount: s.netPay, slot: undefined }));
  // A stub can be listed before its pay date; its slot must exist or it would read as off-cycle.
  const end = Math.max(todayDay, ...stubItems.map((s) => s.day));
  const depositItems: Item[] = deposits.map((d) => ({ day: dayNumber(d.date), amount: d.amount, slot: undefined }));
  const all = [...stubItems, ...depositItems];
  const start = all.length > 0 ? Math.min(...all.map((i) => i.day)) - SLOT_WINDOW_DAYS : anchor;

  const slots: number[] = [];
  const segments = periodSegments(stubs);
  const periodStubs = new Map<number, Item[]>();
  let anchorLimit = end;
  if (segments.length > 0) {
    anchorLimit = segments[0]!.first + segments[0]!.offset - SLOT_WINDOW_DAYS - 1;
    segments.forEach((seg, k) => {
      const until = segments[k + 1]?.first ?? Infinity;
      for (let e = seg.first; e < until && e + seg.offset <= end; e += PERIOD_DAYS) slots.push(e + seg.offset);
    });
    stubs.forEach((stub, i) => {
      if (stub.periodEnd === undefined) return;
      const periodEnd = dayNumber(stub.periodEnd);
      const seg = segments.filter((s) => s.first <= periodEnd).pop()!;
      const slot = periodEnd + seg.offset;
      if (!slots.includes(slot) || Math.abs(stubItems[i]!.day - slot) > SLOT_WINDOW_DAYS) return;
      periodStubs.set(slot, [...(periodStubs.get(slot) ?? []), stubItems[i]!]);
    });
  }
  for (let day = anchor + Math.ceil((start - anchor) / PERIOD_DAYS) * PERIOD_DAYS; day <= anchorLimit; day += PERIOD_DAYS) {
    slots.push(day);
  }
  slots.sort((a, b) => a - b);

  const stubAt = new Map<number, Item>();
  for (const [slot, candidates] of periodStubs) {
    const winner = candidates.reduce((a, b) => (Math.abs(b.day - slot) < Math.abs(a.day - slot) ? b : a));
    winner.slot = slot;
    stubAt.set(slot, winner);
  }
  const freeSlots = slots.filter((s) => !stubAt.has(s));
  for (const [slot, item] of assignSlots(
    stubItems.filter((s) => s.slot === undefined),
    freeSlots,
  )) {
    stubAt.set(slot, item);
  }
  const depositAt = assignSlots(depositItems, slots);

  const out: Paycheck[] = slots.flatMap((slot) => {
    const stub = stubAt.get(slot);
    const deposit = depositAt.get(slot);
    if (slot > todayDay && !stub && !deposit) return [];
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
    return [row];
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
