import { describe, expect, it } from 'vitest';
import { SNAPSHOT_VERSION, type Account, type Snapshot } from '../data/contract';
import { buildDebtViewModel, defaultBudgets } from './debtModel';
import { debtsFromAccounts } from '../payoff/avalanche';

function snap(accounts: Account[]): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: '2030-01-15T00:00:00Z',
    source: 'fixture',
    currency: 'USD',
    accounts,
    cashflowMonthly: [],
    spendingByCategory: [],
    recurring: [],
    paychecks: [],
    goals: [],
    coverage: { hiddenInstitutions: [] },
  };
}

const acct = (id: string, balance: number, apr?: number, kind: Account['kind'] = 'credit'): Account => ({
  id,
  name: `Card ${id}`,
  kind,
  balance,
  apr,
  source: 'manual',
});

const accounts = [acct('a', -1000, 12), acct('b', -2000, 24), acct('c', -500, 24), acct('s', 900, undefined, 'savings')];

describe('buildDebtViewModel', () => {
  it('computes KPIs from debt accounts only', () => {
    const m = buildDebtViewModel(snap(accounts), [500, 1000, 1500]);
    expect(m.hasDebt).toBe(true);
    expect(m.kpis.totalBalance).toBe(3500);
    expect(m.kpis.weightedApr).toBeCloseTo((1000 * 12 + 2000 * 24 + 500 * 24) / 3500, 6);
    expect(m.kpis.monthlyInterest).toBeCloseTo(10 + 40 + 10, 6);
    expect(m.startMonth).toBe('2030-01');
  });

  it('derives default budgets from minimums rounded up to 100', () => {
    const { debts } = debtsFromAccounts(snap(accounts).accounts);
    const mins = debts.reduce((s, d) => s + d.minPayment, 0);
    const base = Math.ceil(mins / 100) * 100;
    expect(defaultBudgets(debts)).toEqual([base, base + 500, base + 1000]);
    expect(defaultBudgets([])).toEqual([]);
  });

  it('orders cards by avalanche: APR desc, then smaller balance', () => {
    const m = buildDebtViewModel(snap(accounts), [500, 1000, 1500]);
    expect(m.cards.map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('reports payoff months and interest for the middle scenario', () => {
    const m = buildDebtViewModel(snap(accounts), [500, 1000, 1500]);
    expect(m.scenarios.every((s) => s.feasible)).toBe(true);
    expect(m.scenarios[1]?.balances[0]).toBe(3500);
    expect(m.scenarios[1]?.balances.at(-1)).toBe(0);
    expect(m.cards.every((c) => c.payoffMonth !== null && c.interestPaid > 0)).toBe(true);
    const total = m.cards.reduce((s, c) => s + c.interestPaid, 0);
    expect(total).toBeCloseTo(m.scenarios[1]?.totalInterest ?? -1, 1);
  });

  it('flags a budget below the minimums as infeasible', () => {
    const m = buildDebtViewModel(snap(accounts), [10, 1000, 1500]);
    expect(m.scenarios[0]?.feasible).toBe(false);
    expect(m.scenarios[1]?.feasible).toBe(true);
  });

  it('treats a negative or non-finite budget as infeasible without throwing', () => {
    const m = buildDebtViewModel(snap(accounts), [-5, 1000, Number.NaN]);
    expect(m.scenarios[0]?.feasible).toBe(false);
    expect(m.scenarios[2]?.feasible).toBe(false);
  });

  it('passes through missing-APR warnings', () => {
    const m = buildDebtViewModel(snap([acct('x', -400)]), [100, 200, 300]);
    expect(m.warnings).toHaveLength(1);
  });

  it('has an empty state with no debt accounts', () => {
    const m = buildDebtViewModel(snap([acct('s', 900, undefined, 'savings')]), []);
    expect(m.hasDebt).toBe(false);
    expect(m.cards).toEqual([]);
    expect(m.kpis.weightedApr).toBe(0);
  });
});
