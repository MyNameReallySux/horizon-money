/** Bump when the snapshot shape changes incompatibly; `isSnapshot` rejects other versions. */
export const SNAPSHOT_VERSION = 1;

/** Kind of account; drives which KPIs it contributes to. */
export type AccountKind =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'loan'
  | 'investment'
  | 'property'
  | 'other';

/** One account. Liabilities (credit, loan) carry negative balances; assets positive. */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Current balance in whole or fractional dollars. Negative for money owed. */
  balance: number;
  /** Annual percentage rate as a percent (19.99 means 19.99%), for debt accounts. */
  apr?: number;
  /** True when the balance is hand-maintained rather than synced from an institution. */
  manual?: boolean;
}

/** Totals for one calendar month. */
export interface CashflowMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Positive dollars in. */
  income: number;
  /** Dollars out, negative by convention. */
  expense: number;
}

/** Spending in one category for one month. */
export interface CategorySpend {
  /** `YYYY-MM`. */
  month: string;
  group: string;
  category: string;
  /** Dollars, negative for spending. */
  amount: number;
}

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

/** A recurring bill, subscription or income stream. */
export interface RecurringItem {
  name: string;
  /** Dollars per occurrence; negative for bills. */
  amount: number;
  frequency: RecurringFrequency;
  category: string;
  /** ISO date `YYYY-MM-DD` of the next expected occurrence. */
  nextDate: string;
}

/** An expected paycheck and, once it lands, what actually arrived. */
export interface Paycheck {
  /** ISO date `YYYY-MM-DD`. */
  expectedDate: string;
  expectedAmount: number;
  /** Null when the paycheck has not arrived (a miss, once `expectedDate` has passed). */
  receivedDate: string | null;
  receivedAmount: number | null;
}

export type GoalPeriod = 'week' | 'month' | 'year';

/** A target for some metric over a period. */
export interface Goal {
  id: string;
  name: string;
  period: GoalPeriod;
  /** Free-form metric key the UI interprets, e.g. `spending` or `savings`. */
  metric: string;
  /** Target in the metric's unit, positive. */
  target: number;
}

/**
 * The whole dataset the app renders, fetched from `/snapshot.json`.
 * Expenses are negative and liabilities are negative balances throughout.
 */
export interface Snapshot {
  version: typeof SNAPSHOT_VERSION;
  /** ISO 8601 timestamp of when the snapshot was produced. */
  generatedAt: string;
  source: 'fixture' | 'monarch';
  currency: 'USD';
  accounts: Account[];
  cashflowMonthly: CashflowMonth[];
  spendingByCategory: CategorySpend[];
  recurring: RecurringItem[];
  paychecks: Paycheck[];
  goals: Goal[];
}

const REQUIRED_ARRAYS = [
  'accounts',
  'cashflowMonthly',
  'spendingByCategory',
  'recurring',
  'paychecks',
  'goals',
] as const;

/** Shallow runtime guard: checks version, source, currency and that the required arrays exist. */
export function isSnapshot(x: unknown): x is Snapshot {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  if (s.version !== SNAPSHOT_VERSION) return false;
  if (typeof s.generatedAt !== 'string') return false;
  if (s.source !== 'fixture' && s.source !== 'monarch') return false;
  if (s.currency !== 'USD') return false;
  return REQUIRED_ARRAYS.every((key) => Array.isArray(s[key]));
}
