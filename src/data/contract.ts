/** Bump when the snapshot shape changes incompatibly; `isSnapshot` rejects other versions. */
export const SNAPSHOT_VERSION = 2;

/** Kind of account; drives which KPIs it contributes to. */
export type AccountKind =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'loan'
  | 'investment'
  | 'property'
  | 'other';

/** Where an account's balance comes from. */
export type AccountSource = 'monarch' | 'manual';

/** One account. Liabilities (credit, loan) carry negative balances; assets positive. */
export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Current balance in whole or fractional dollars. Negative for money owed. */
  balance: number;
  /** Annual percentage rate as a percent (19.99 means 19.99%), for debt accounts. */
  apr?: number;
  /** `monarch` when synced through Monarch, `manual` when hand-maintained in manual.json. */
  source: AccountSource;
  /** ISO date `YYYY-MM-DD` the balance was true on; set for manual accounts. */
  asOf?: string;
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

/** How often a recurring item repeats. */
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

/** The span a goal is measured over. */
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

/** A fixed biweekly pay cadence, used to derive expected paycheck dates. */
export interface PaySchedule {
  cadence: 'biweekly';
  /** A known pay date ; every 14th day from it (either direction) is a pay date. */
  anchorDate: string;
  /** Expected take-home per paycheck in dollars, positive. */
  expectedAmount: number;
}

/** What Monarch could not show, so the UI can say the data is partial. */
export interface Coverage {
  /** Names of institutions Monarch reports as hidden or excluded from the data. */
  hiddenInstitutions: string[];
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
  /** Present when a pay schedule is configured in manual.json. */
  paySchedule?: PaySchedule;
  coverage: Coverage;
}

const REQUIRED_ARRAYS = [
  'accounts',
  'cashflowMonthly',
  'spendingByCategory',
  'recurring',
  'paychecks',
  'goals',
] as const;

/** Shallow runtime guard: checks version, source, currency, coverage and that the required arrays exist. */
export function isSnapshot(x: unknown): x is Snapshot {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  if (s.version !== SNAPSHOT_VERSION) return false;
  if (typeof s.generatedAt !== 'string') return false;
  if (s.source !== 'fixture' && s.source !== 'monarch') return false;
  if (s.currency !== 'USD') return false;
  const coverage = s.coverage as { hiddenInstitutions?: unknown } | null | undefined;
  if (typeof coverage !== 'object' || coverage === null) return false;
  if (!Array.isArray(coverage.hiddenInstitutions)) return false;
  return REQUIRED_ARRAYS.every((key) => Array.isArray(s[key]));
}
