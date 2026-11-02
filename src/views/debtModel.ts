import type { Snapshot } from '../data/contract';
import { debtsFromAccounts, simulatePayoff, type Debt, type PayoffPlan } from '../payoff/avalanche';

export interface DebtKpis {
  totalBalance: number;
  /** Balance-weighted average APR as a percent; 0 with no debt. */
  weightedApr: number;
  /** One month of interest at current balances: sum of balance * apr / 12. */
  monthlyInterest: number;
}

export interface ScenarioModel {
  budget: number;
  feasible: boolean;
  months: number;
  finalMonth: string | null;
  totalInterest: number;
  /** Total remaining balance; index 0 is today, index n the end of month n. Empty when infeasible without a schedule. */
  balances: number[];
}

export interface CardRow {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  /** `YYYY-MM` the card reaches zero in the middle scenario; null when it does not. */
  payoffMonth: string | null;
  /** Interest paid on this card over the middle scenario's simulated months. */
  interestPaid: number;
}

export interface DebtViewModel {
  hasDebt: boolean;
  startMonth: string;
  kpis: DebtKpis;
  scenarios: ScenarioModel[];
  /** Avalanche order (highest APR first, ties by smaller balance), with the middle scenario's results. */
  cards: CardRow[];
  warnings: string[];
}

/**
 * Default monthly budgets: the sum of minimum payments rounded up to the next 100, then
 * that figure plus 500 and plus 1000. Derived from the data so no amount is hard-coded.
 * Empty when there is no debt.
 */
export function defaultBudgets(debts: Debt[]): number[] {
  if (debts.length === 0) return [];
  const minimums = debts.reduce((sum, d) => sum + d.minPayment, 0);
  const base = Math.max(100, Math.ceil(minimums / 100) * 100);
  return [base, base + 500, base + 1000];
}

function simulate(debts: Debt[], budget: number, startMonth: string): PayoffPlan | null {
  if (!Number.isFinite(budget) || budget < 0) return null;
  return simulatePayoff(debts, budget, startMonth, 'avalanche');
}

/**
 * Shapes a snapshot into what the Debt view renders. `budgets` are the three monthly
 * amounts to compare (use {@link defaultBudgets} for the initial ones); the second is
 * the scenario shown in the per-card table. A negative or non-finite budget yields an
 * infeasible scenario rather than throwing.
 */
export function buildDebtViewModel(snapshot: Snapshot, budgets: number[]): DebtViewModel {
  const { debts, warnings } = debtsFromAccounts(snapshot.accounts);
  const startMonth = snapshot.generatedAt.slice(0, 7);
  const totalBalance = debts.reduce((sum, d) => sum + d.balance, 0);
  const monthlyInterest = debts.reduce((sum, d) => sum + (d.balance * d.apr) / 12 / 100, 0);
  const kpis: DebtKpis = {
    totalBalance,
    weightedApr: totalBalance > 0 ? debts.reduce((s, d) => s + d.balance * d.apr, 0) / totalBalance : 0,
    monthlyInterest,
  };

  const plans = budgets.map((b) => simulate(debts, b, startMonth));
  const scenarios: ScenarioModel[] = budgets.map((budget, i) => {
    const plan = plans[i] ?? null;
    return {
      budget,
      feasible: plan?.feasible ?? false,
      months: plan?.months ?? 0,
      finalMonth: plan?.finalMonth ?? null,
      totalInterest: plan?.totalInterest ?? 0,
      balances: plan
        ? [totalBalance, ...plan.schedule.map((row) => row.debts.reduce((s, d) => s + d.balance, 0))]
        : [],
    };
  });

  const middle = plans[Math.floor(budgets.length / 2)] ?? null;
  const interestById = new Map<string, number>();
  for (const row of middle?.schedule ?? []) {
    for (const d of row.debts) interestById.set(d.id, (interestById.get(d.id) ?? 0) + d.interest);
  }
  const cards: CardRow[] = [...debts]
    .sort((a, b) => b.apr - a.apr || a.balance - b.balance || (a.id < b.id ? -1 : 1))
    .map((d) => ({
      id: d.id,
      name: d.name,
      balance: d.balance,
      apr: d.apr,
      minPayment: d.minPayment,
      payoffMonth: middle?.payoffMonth[d.id] ?? null,
      interestPaid: Math.round((interestById.get(d.id) ?? 0) * 100) / 100,
    }));

  return { hasDebt: debts.length > 0, startMonth, kpis, scenarios, cards, warnings };
}
