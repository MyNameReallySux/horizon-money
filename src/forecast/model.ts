import type {
  CashflowMonth,
  PaySchedule,
  RecurringFrequency,
  RecurringItem,
} from '../data/contract.ts';
import { isIsoDate } from '../data/manual.ts';

/** Everything the forecast reads; pass pieces of a `Snapshot` straight through. */
export interface ForecastInput {
  /** Local `YYYY-MM-DD`. Injected so the model never reads the clock. */
  today: string;
  recurring: RecurringItem[];
  cashflowMonthly: CashflowMonth[];
  paySchedule?: PaySchedule;
  /** Months to forecast, starting with the month containing `today`. Default 12. */
  horizonMonths?: number;
  /** Complete trailing months averaged for flexible spend and fallback income. Default 2. */
  trailingMonths?: number;
}

/** Where the income line came from. */
export type IncomeSource = 'pay-schedule' | 'recurring' | 'trailing-average' | 'none';

/** One forecast month. Every amount is positive dollars except `net`, `low`, `high` and `cumulativeNet`. */
export interface ForecastMonth {
  /** `YYYY-MM`. */
  month: string;
  income: number;
  fixed: number;
  flexible: number;
  /** `income - fixed - flexible`. */
  net: number;
  /** `net` minus one standard deviation of flexible spend. */
  low: number;
  /** `net` plus one standard deviation of flexible spend. */
  high: number;
  /** Running sum of `net` from the first forecast month. */
  cumulativeNet: number;
}

/** The inputs the numbers rest on, so the UI can show them. */
export interface ForecastAssumptions {
  trailingMonths: number;
  /** Complete trailing months actually found in `cashflowMonthly`. */
  trailingMonthsUsed: number;
  /** Trailing months (`YYYY-MM`) the flexible average and band were computed over. */
  trailingWindow: string[];
  /** Average monthly flexible spend (positive dollars), before first-month proration. */
  flexibleMonthlyAverage: number;
  /** Sample standard deviation of monthly flexible spend; 0 with fewer than 2 months. */
  flexibleStdDev: number;
  incomeSource: IncomeSource;
  /** Pay dates counted per forecast month; only filled when income comes from `paySchedule`. */
  paychecksPerMonth: Record<string, number>;
}

/** Result of {@link forecastCashflow}. */
export interface Forecast {
  months: ForecastMonth[];
  warnings: string[];
  assumptions: ForecastAssumptions;
}

const DAY_MS = 86_400_000;
const MONTH_STEP: Partial<Record<RecurringFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  semiyearly: 6,
  yearly: 12,
};

/** Occurrences per month used to turn a bill into a monthly equivalent. */
const PER_MONTH: Record<RecurringFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  quarterly: 1 / 3,
  semiyearly: 1 / 6,
  yearly: 1 / 12,
};

function round2(x: number): number {
  return Math.round(x * 100) / 100 + 0;
}

function parts(iso: string): [number, number, number] {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return [y, m, d];
}

function toDayNumber(iso: string): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Builds `YYYY-MM-DD`, clamping `day` to the month's length. */
function clampedDate(year: number, month: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function monthKey(index: number): string {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function monthIndex(iso: string): number {
  const [y, m] = parts(iso);
  return y * 12 + (m - 1);
}

function stepDays(startIso: string, step: number, from: string, to: string): string[] {
  const start = toDayNumber(startIso);
  const lo = toDayNumber(from);
  const hi = toDayNumber(to);
  const out: string[] = [];
  let n = start + Math.ceil((lo - start) / step) * step;
  for (; n <= hi; n += step) out.push(fromDayNumber(n));
  return out;
}

/**
 * Dates a recurring item lands on within `[from, to]` (inclusive ISO dates), never before its
 * `nextDate`. Weekly and biweekly step by real days. Monthly, quarterly, semiyearly and yearly
 * step by months from `nextDate`'s day of month, clamped to short months without drifting (a
 * 31st lands on Feb 28, then Mar 31 again). Semimonthly lands on `nextDate`'s day (folded into
 * 1-15 by subtracting 15 when it is later) and 15 days after it, e.g. the 1st and 16th, or the
 * 15th and 30th, each clamped.
 */
export function expandOccurrences(
  item: Pick<RecurringItem, 'frequency' | 'nextDate'>,
  from: string,
  to: string,
): string[] {
  const { frequency, nextDate } = item;
  const lower = nextDate > from ? nextDate : from;
  if (frequency === 'weekly') return stepDays(nextDate, 7, lower, to);
  if (frequency === 'biweekly') return stepDays(nextDate, 14, lower, to);

  const [, , day] = parts(nextDate);
  const out: string[] = [];
  const first = monthIndex(nextDate);
  const last = monthIndex(to);
  if (frequency === 'semimonthly') {
    const a = day <= 15 ? day : day - 15;
    for (let i = first; i <= last; i++) {
      const year = Math.floor(i / 12);
      const month = (i % 12) + 1;
      for (const d of [clampedDate(year, month, a), clampedDate(year, month, a + 15)]) {
        if (d >= lower && d <= to) out.push(d);
      }
    }
    return out;
  }

  const step = MONTH_STEP[frequency] ?? 1;
  for (let i = first; i <= last; i += step) {
    const d = clampedDate(Math.floor(i / 12), (i % 12) + 1, day);
    if (d >= lower && d <= to) out.push(d);
  }
  return out;
}

/**
 * Biweekly pay dates in `[from, to]`: every 14th day from `anchorDate`, in either direction,
 * so a month can hold three.
 */
export function payDates(schedule: Pick<PaySchedule, 'anchorDate'>, from: string, to: string): string[] {
  return stepDays(schedule.anchorDate, 14, from, to);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Pure cash-flow forecast, no clock and no I/O.
 *
 * The first forecast month is the one containing `today` and covers only `today` onward:
 * dated items before `today` are dropped, and the per-month averages (flexible spend, and
 * trailing-average income) are prorated by the days remaining.
 *
 * - Income: `paySchedule` pay dates actually falling in each month; else positive recurring
 *   streams expanded the same way as bills; else the trailing average of
 *   `cashflowMonthly.income`.
 * - Fixed: negative recurring items expanded by {@link expandOccurrences}, as positive dollars.
 * - Flexible: per trailing complete month (the current partial month is excluded),
 *   `-expense` minus the recurring-bill monthly equivalent, averaged unfloored over the
 *   last `trailingMonths` months; only the resulting average is floored at 0. Recurring items
 *   with an unknown frequency, invalid `nextDate` or non-finite amount are skipped with a warning. Category rows are not read, so spend with no recurring
 *   stream is whatever remains of the monthly total.
 * - Band: `low`/`high` are `net` -/+ one sample standard deviation of that same window. With
 *   fewer than 2 months the band is 0 and a warning is returned.
 *
 * Card amortization is out of scope; interest and payments belong to the debt engine.
 */
export function forecastCashflow(input: ForecastInput): Forecast {
  const { today, recurring, cashflowMonthly, paySchedule } = input;
  const horizon = input.horizonMonths ?? 12;
  const trailing = input.trailingMonths ?? 2;
  const warnings: string[] = [];

  const startIdx = monthIndex(today);
  const keys = Array.from({ length: horizon }, (_, i) => monthKey(startIdx + i));
  const endIdx = startIdx + horizon - 1;
  const endDate = clampedDate(Math.floor(endIdx / 12), (endIdx % 12) + 1, 31);

  const todayMonth = today.slice(0, 7);
  const complete = cashflowMonthly
    .filter((c) => c.month < todayMonth)
    .sort((a, b) => a.month.localeCompare(b.month));
  const window = trailing > 0 ? complete.slice(-trailing) : [];

  const valid = recurring.filter((r, i) => {
    const problem = !Object.hasOwn(PER_MONTH, r.frequency)
      ? 'unknown frequency'
      : !isIsoDate(r.nextDate)
        ? 'invalid nextDate'
        : !Number.isFinite(r.amount)
          ? 'non-finite amount'
          : null;
    if (problem) warnings.push(`recurring item ${i} skipped: ${problem}`);
    return problem === null;
  });
  const bills = valid.filter((r) => r.amount < 0);
  const streams = valid.filter((r) => r.amount > 0);
  const billMonthly = bills.reduce((a, r) => a - r.amount * PER_MONTH[r.frequency], 0);

  // Unfloored so one low month cannot bias the average or the band upward.
  const flexHistory = window.map((c) => -c.expense - billMonthly);
  const flexAvg = flexHistory.length > 0 ? Math.max(0, mean(flexHistory)) : 0;
  const flexSd = sampleStdDev(flexHistory);
  if (window.length === 0) {
    warnings.push('No complete trailing months in cashflowMonthly; flexible spend is 0.');
  } else if (window.length < trailing) {
    warnings.push(`Only ${window.length} of ${trailing} trailing months available for flexible spend.`);
  }
  if (window.length < 2) {
    warnings.push('Fewer than 2 trailing months; the forecast band is 0.');
  }

  const sumByMonth = (dates: string[], amount: number): Map<string, number> => {
    const m = new Map<string, number>();
    for (const d of dates) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0) + amount);
    return m;
  };

  const fixedByMonth = new Map<string, number>();
  for (const r of bills) {
    for (const [k, v] of sumByMonth(expandOccurrences(r, today, endDate), -r.amount)) {
      fixedByMonth.set(k, (fixedByMonth.get(k) ?? 0) + v);
    }
  }

  const paychecksPerMonth: Record<string, number> = {};
  const incomeByMonth = new Map<string, number>();
  let incomeSource: IncomeSource = 'none';
  const [ty, tm, td] = parts(today);
  const firstFraction = (daysInMonth(ty, tm) - td + 1) / daysInMonth(ty, tm);

  const cadence: string | undefined = paySchedule?.cadence;
  const usePaySchedule = paySchedule !== undefined && cadence === 'biweekly';
  if (paySchedule && !usePaySchedule) {
    warnings.push(`pay schedule cadence ${cadence} not supported; using fallback income`);
  }

  if (paySchedule && usePaySchedule) {
    incomeSource = 'pay-schedule';
    const dates = payDates(paySchedule, today, endDate);
    for (const k of keys) paychecksPerMonth[k] = 0;
    for (const d of dates) {
      const k = d.slice(0, 7);
      paychecksPerMonth[k] = (paychecksPerMonth[k] ?? 0) + 1;
    }
    for (const k of keys) incomeByMonth.set(k, (paychecksPerMonth[k] ?? 0) * paySchedule.expectedAmount);
  } else if (streams.length > 0) {
    incomeSource = 'recurring';
    for (const r of streams) {
      for (const [k, v] of sumByMonth(expandOccurrences(r, today, endDate), r.amount)) {
        incomeByMonth.set(k, (incomeByMonth.get(k) ?? 0) + v);
      }
    }
  } else if (window.length > 0) {
    incomeSource = 'trailing-average';
    const avg = mean(window.map((c) => c.income));
    keys.forEach((k, i) => incomeByMonth.set(k, i === 0 ? avg * firstFraction : avg));
  } else {
    warnings.push('No income source: no pay schedule, recurring income or trailing history; income is 0.');
  }

  let cumulative = 0;
  const months: ForecastMonth[] = keys.map((month, i) => {
    const scale = i === 0 ? firstFraction : 1;
    const income = round2(incomeByMonth.get(month) ?? 0);
    const fixed = round2(fixedByMonth.get(month) ?? 0);
    const flexible = round2(flexAvg * scale);
    const net = round2(income - fixed - flexible);
    const band = flexSd * scale;
    cumulative = round2(cumulative + net);
    return {
      month,
      income,
      fixed,
      flexible,
      net,
      low: round2(net - band),
      high: round2(net + band),
      cumulativeNet: cumulative,
    };
  });

  return {
    months,
    warnings,
    assumptions: {
      trailingMonths: trailing,
      trailingMonthsUsed: window.length,
      trailingWindow: window.map((c) => c.month),
      flexibleMonthlyAverage: round2(flexAvg),
      flexibleStdDev: round2(flexSd),
      incomeSource,
      paychecksPerMonth,
    },
  };
}
