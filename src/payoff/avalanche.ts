import type { Account } from '../data/contract.ts';

/** Order in which extra money is aimed at debts. */
export type PayoffStrategy = 'avalanche' | 'snowball';

/** Months simulated before giving up and reporting the plan as infeasible. */
export const MAX_MONTHS = 600;

/** One debt as the engine sees it: balance is positive dollars owed, apr a percent (19.99 = 19.99%). */
export interface Debt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
}

/** One debt's slice of one simulated month. All amounts are dollars rounded to cents. */
export interface DebtMonth {
  id: string;
  /** Balance at the end of the month, after interest and payment. */
  balance: number;
  /** Interest accrued at the start of the month. */
  interest: number;
  /** Money paid to this debt this month. */
  payment: number;
}

/** One simulated month. */
export interface ScheduleRow {
  /** `YYYY-MM`; the first row is the start month. */
  month: string;
  debts: DebtMonth[];
}

/** Result of {@link simulatePayoff}. */
export interface PayoffPlan {
  strategy: PayoffStrategy;
  budget: number;
  /**
   * False when the budget does not cover the minimums, the balance stops falling
   * (negative amortization), or {@link MAX_MONTHS} passes without clearing every debt.
   * An infeasible plan keeps whatever schedule was simulated; the budget-below-minimums
   * case has an empty schedule.
   */
  feasible: boolean;
  /** Simulated months until everything is paid (or until the simulation stopped). */
  months: number;
  /** `YYYY-MM` of the last payment; null when infeasible. */
  finalMonth: string | null;
  /**
   * Month each debt reached zero, keyed by debt id; null if it never did.
   * A debt that starts at zero reports the start month.
   */
  payoffMonth: Record<string, string | null>;
  totalInterest: number;
  totalPaid: number;
  schedule: ScheduleRow[];
}

/** Compact per-budget outcome used by the dashboard's scenario cards. */
export interface ScenarioSummary {
  budget: number;
  feasible: boolean;
  months: number;
  finalMonth: string | null;
  totalInterest: number;
  totalPaid: number;
}

/** Debts built from accounts plus human-readable notes about assumptions made. */
export interface DebtsFromAccounts {
  debts: Debt[];
  warnings: string[];
}

const cents = (dollars: number): number => Math.round(dollars * 100);
const dollars = (c: number): number => c / 100;

/**
 * Adds `n` months to a `YYYY-MM` string. Throws on a malformed month.
 */
export function addMonths(month: string, n: number): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * Default minimum payment when the data has none: `max(25, 1% of balance + one month of
 * interest)`, rounded to cents. Mirrors the common card-issuer formula.
 */
export function defaultMinPayment(balance: number, apr: number): number {
  const interest = (balance * apr) / 1200;
  return dollars(Math.max(2500, cents(balance * 0.01 + interest)));
}

/**
 * Builds engine debts from snapshot accounts. Only `credit` and `loan` accounts with a
 * negative balance count; the balance is flipped positive. A missing APR is assumed to be
 * 0 and recorded in `warnings` rather than thrown. The minimum payment follows
 * {@link defaultMinPayment}, since the snapshot carries none.
 */
export function debtsFromAccounts(accounts: Account[]): DebtsFromAccounts {
  const debts: Debt[] = [];
  const warnings: string[] = [];
  for (const a of accounts) {
    if ((a.kind !== 'credit' && a.kind !== 'loan') || !(a.balance < 0)) continue;
    const balance = -a.balance;
    let apr = 0;
    if (typeof a.apr === 'number' && Number.isFinite(a.apr) && a.apr >= 0) {
      apr = a.apr;
    } else {
      warnings.push(`${a.name}: no APR on record, assumed 0%`);
    }
    debts.push({ id: a.id, name: a.name, balance, apr, minPayment: defaultMinPayment(balance, apr) });
  }
  return { debts, warnings };
}

interface State {
  id: string;
  apr: number;
  balance: number;
  min: number;
}

/**
 * Month-by-month payoff simulation.
 *
 * Each month: interest accrues at `apr / 12` on every open debt; every open debt gets its
 * minimum (capped at balance plus interest); the rest of `budget` goes to the target debt
 * (avalanche: highest APR, ties by smaller balance; snowball: smallest balance), spilling to
 * the next target once that one is cleared. Minimums freed by a cleared debt therefore
 * roll into the budget automatically, because `budget` is the total across all debts.
 *
 * Money is held as integer cents and interest is rounded to the cent each month, so there
 * is no float drift and every schedule row sums exactly.
 *
 * Infeasible (`feasible: false`) when the budget is below the opening minimums, when a
 * month's payments do not exceed its interest while debt remains, or after
 * {@link MAX_MONTHS} months.
 *
 * Throws `RangeError` on a non-finite or negative budget, a debt with a non-finite balance,
 * APR or minimum payment, a negative APR, or two debts sharing an id.
 */
export function simulatePayoff(
  debts: Debt[],
  budget: number,
  startMonth: string,
  strategy: PayoffStrategy = 'avalanche',
): PayoffPlan {
  addMonths(startMonth, 0);
  if (!Number.isFinite(budget) || budget < 0) throw new RangeError(`Invalid budget ${budget}`);
  for (const d of debts) {
    if (![d.balance, d.apr, d.minPayment].every(Number.isFinite) || d.apr < 0) {
      throw new RangeError(`Invalid debt "${d.id}"`);
    }
  }
  // Payments and interest are keyed by id, so a repeated id would be counted twice.
  if (new Set(debts.map((d) => d.id)).size !== debts.length) {
    throw new RangeError('Duplicate debt id');
  }
  const budgetC = cents(budget);
  const payoffMonth: Record<string, string | null> = {};
  const states: State[] = debts.map((d) => {
    const balance = Math.max(0, cents(d.balance));
    payoffMonth[d.id] = balance === 0 ? startMonth : null;
    return { id: d.id, apr: d.apr, balance, min: Math.max(0, cents(d.minPayment)) };
  });
  const schedule: ScheduleRow[] = [];
  let totalInterest = 0;
  let totalPaid = 0;

  const finish = (feasible: boolean, months: number): PayoffPlan => ({
    strategy,
    budget,
    feasible,
    months,
    finalMonth: feasible ? (months === 0 ? startMonth : addMonths(startMonth, months - 1)) : null,
    payoffMonth,
    totalInterest: dollars(totalInterest),
    totalPaid: dollars(totalPaid),
    schedule,
  });

  const openingMins = states.reduce(
    (sum, s) => sum + Math.min(s.min, s.balance + Math.round((s.balance * s.apr) / 1200)),
    0,
  );
  if (budgetC < openingMins) return finish(false, 0);

  const byPriority = (a: State, b: State): number => {
    if (strategy === 'avalanche' && a.apr !== b.apr) return b.apr - a.apr;
    return a.balance - b.balance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };

  for (let i = 0; i < MAX_MONTHS; i++) {
    const open = states.filter((s) => s.balance > 0);
    if (open.length === 0) return finish(true, i);

    const interest = new Map<string, number>();
    const payment = new Map<string, number>();
    let monthInterest = 0;
    let remaining = budgetC;
    for (const s of open) {
      const int = Math.round((s.balance * s.apr) / 1200);
      interest.set(s.id, int);
      monthInterest += int;
      s.balance += int;
      const pay = Math.min(s.min, s.balance);
      payment.set(s.id, pay);
      remaining -= pay;
    }
    for (const s of [...open].sort(byPriority)) {
      if (remaining <= 0) break;
      const extra = Math.min(remaining, s.balance - (payment.get(s.id) ?? 0));
      payment.set(s.id, (payment.get(s.id) ?? 0) + extra);
      remaining -= extra;
    }

    const month = addMonths(startMonth, i);
    let monthPaid = 0;
    for (const s of open) {
      const pay = payment.get(s.id) ?? 0;
      s.balance -= pay;
      monthPaid += pay;
      if (s.balance === 0) payoffMonth[s.id] = month;
    }
    totalInterest += monthInterest;
    totalPaid += monthPaid;
    schedule.push({
      month,
      debts: states.map((s) => ({
        id: s.id,
        balance: dollars(s.balance),
        interest: dollars(interest.get(s.id) ?? 0),
        payment: dollars(payment.get(s.id) ?? 0),
      })),
    });

    const stillOpen = states.some((s) => s.balance > 0);
    if (stillOpen && monthPaid <= monthInterest) return finish(false, i + 1);
  }
  return finish(!states.some((s) => s.balance > 0), MAX_MONTHS);
}

/**
 * Runs {@link simulatePayoff} once per budget (the dashboard shows three) and returns a
 * summary for each, in the order given.
 */
export function runScenarios(
  debts: Debt[],
  budgets: number[],
  startMonth: string,
  strategy: PayoffStrategy = 'avalanche',
): ScenarioSummary[] {
  return budgets.map((budget) => {
    const p = simulatePayoff(debts, budget, startMonth, strategy);
    return {
      budget,
      feasible: p.feasible,
      months: p.months,
      finalMonth: p.finalMonth,
      totalInterest: p.totalInterest,
      totalPaid: p.totalPaid,
    };
  });
}
