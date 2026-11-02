import { SNAPSHOT_VERSION, type Account, type Goal, type Snapshot } from '../data/contract.ts';
import { isManualEntry, type ManualEntry } from '../data/manual.ts';
import { parseTargets, type Target } from '../data/targets.ts';
import { isPaystubIndex } from '../paystubs/index.ts';
import { mapAccounts } from './accounts.ts';
import { DEFAULT_CASHFLOW_OPTIONS, mapCashflow, mapSpending, type CashflowOptions } from './cashflow.ts';
import { mapGoals } from './goals.ts';
import { buildPaycheckLedger, buildPaychecks, deriveSchedule, mapDeposits } from './paychecks.ts';
import { mapRecurring } from './recurring.ts';

/** Parsed (already unwrapped) contents of the raw files; `undefined` means the file was absent. */
export interface RawInputs {
  accounts: unknown;
  cashflowMonthly?: unknown;
  spendingByCategory?: unknown;
  categories?: unknown;
  recurring?: unknown;
  goals?: unknown;
  paychecks?: unknown;
  manual?: unknown;
  /** Parsed `targets.json`; absent means no plan file, which is not worth a warning. */
  targets?: unknown;
  /** Parsed `paystubs/index.json`; when present, paychecks are reconciled against it. */
  paystubs?: unknown;
}

export interface BuildOptions {
  /** Moment the snapshot is produced; its local calendar date is "today" for paycheck cutoffs. */
  now: Date;
  cashflow?: CashflowOptions;
}

/** Local-calendar `YYYY-MM-DD`; `toISOString` gives the UTC date, which is tomorrow for an evening run west of UTC. */
const localDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Appends manual accounts after Monarch ones; an id present in both is an error. */
export function mergeManualAccounts(monarch: Account[], manual: ManualEntry): Account[] {
  const taken = new Set(monarch.map((a) => a.id));
  const added = manual.accounts.map((m): Account => {
    if (taken.has(m.id)) throw new Error('manual.json: an account id collides with a Monarch account id');
    const balance = m.kind === 'credit' || m.kind === 'loan' ? -Math.abs(m.balance) : m.balance;
    const account: Account = { id: m.id, name: m.name, kind: m.kind, balance, source: 'manual', asOf: m.asOf };
    if (m.apr !== undefined) account.apr = m.apr;
    return account;
  });
  return [...monarch, ...added];
}

/**
 * Appends target goals after the Monarch goals. An id present in both is a conflict: the file
 * wins, because it is the hand-written plan, and the Monarch goal is dropped with a warning.
 */
export function mergeTargetGoals(monarch: Goal[], targets: Target[], warn: (m: string) => void): Goal[] {
  const ids = new Set(targets.map((t) => t.id));
  const kept = monarch.filter((g) => !ids.has(g.id));
  const clashes = monarch.length - kept.length;
  if (clashes > 0) warn(`targets.json: ${clashes} target id(s) match a Monarch goal id; the targets.json entry wins`);
  const added = targets.map((t): Goal => {
    const goal: Goal = {
      id: t.id,
      name: t.name,
      period: t.period,
      metric: t.metric,
      target: t.target,
      direction: t.direction,
    };
    if (t.stretch !== undefined) goal.stretch = t.stretch;
    if (t.by !== undefined) goal.by = t.by;
    return goal;
  });
  return [...kept, ...added];
}

/**
 * Assembles a snapshot from the raw MCP responses and manual entry. Optional sections that are
 * absent come out empty with a warning; a missing `accounts` is the caller's error to raise.
 * Throws on malformed input. Warnings never contain names or amounts.
 */
export function buildSnapshot(
  input: RawInputs,
  { now, cashflow = DEFAULT_CASHFLOW_OPTIONS }: BuildOptions,
): { snapshot: Snapshot; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);

  if (input.manual !== undefined && !isManualEntry(input.manual)) {
    throw new Error('manual.json: does not match the manual entry format (see docs/data-pipeline.md)');
  }
  const manual = input.manual;

  const mapped = mapAccounts(input.accounts, warn);
  const accounts = manual ? mergeManualAccounts(mapped.accounts, manual) : mapped.accounts;

  const optional = <T>(value: unknown, file: string, map: (v: unknown) => T): T | [] => {
    if (value === undefined) {
      warn(`${file} is missing; that section is empty`);
      return [];
    }
    return map(value);
  };

  const today = localDate(now);
  const paySchedule = manual?.paySchedule;
  let paychecks: Snapshot['paychecks'] = [];
  if (input.paystubs !== undefined) {
    if (!isPaystubIndex(input.paystubs)) {
      throw new Error('paystubs/index.json: does not match the pay stub index format (see docs/paystubs.md)');
    }
    const stubs = input.paystubs.stubs.map((s) => ({ date: s.payDate, netPay: s.netPay }));
    const schedule = paySchedule ?? deriveSchedule(stubs, warn);
    if (input.paychecks === undefined) warn('paychecks.json is missing; paychecks are reconciled without deposits');
    const deposits = input.paychecks === undefined ? [] : mapDeposits(input.paychecks, warn);
    if (schedule) {
      paychecks = buildPaycheckLedger(schedule, stubs, deposits, today);
    } else {
      warn('paystubs/index.json has no stubs and manual.json has no paySchedule; paychecks section is empty');
    }
  } else if (input.paychecks === undefined) {
    warn('paychecks.json is missing; that section is empty');
  } else if (!paySchedule) {
    warn('no paySchedule in manual.json; paychecks section is empty');
  } else {
    paychecks = buildPaychecks(paySchedule, mapDeposits(input.paychecks, warn), today);
  }

  if (input.spendingByCategory !== undefined && input.categories === undefined) {
    warn('categories.json is missing; spending is not grouped and transfers are not filtered');
  }

  let goals = optional(input.goals, 'goals.json', (v) => mapGoals(v, warn));
  if (input.targets !== undefined) {
    const parsed = parseTargets(input.targets);
    parsed.warnings.forEach(warn);
    const { effective } = parsed;
    if (effective && (today < effective.from || today > effective.to)) {
      warn(`targets.json: plan not in effect on ${today} (effective ${effective.from}..${effective.to}); targets skipped`);
    } else {
      goals = mergeTargetGoals(goals, parsed.targets, warn);
    }
  }

  const snapshot: Snapshot = {
    version: SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    source: 'monarch',
    currency: 'USD',
    accounts,
    cashflowMonthly: optional(input.cashflowMonthly, 'cashflow-monthly.json', (v) => mapCashflow(v, cashflow, warn)),
    spendingByCategory: optional(input.spendingByCategory, 'spending-by-category.json', (v) =>
      mapSpending(v, input.categories, warn),
    ),
    recurring: optional(input.recurring, 'recurring.json', (v) => mapRecurring(v, warn)),
    paychecks,
    goals,
    coverage: { hiddenInstitutions: mapped.hiddenInstitutions },
  };
  if (paySchedule) snapshot.paySchedule = paySchedule;
  return { snapshot, warnings };
}
