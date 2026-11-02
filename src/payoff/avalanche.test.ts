import { describe, expect, it } from 'vitest';
import type { Account } from '../data/contract.ts';
import {
  addMonths,
  debtsFromAccounts,
  defaultMinPayment,
  runScenarios,
  simulatePayoff,
  type Debt,
} from './avalanche.ts';

const debt = (over: Partial<Debt>): Debt => ({
  id: 'a',
  name: 'Card A',
  balance: 1000,
  apr: 12,
  minPayment: 25,
  ...over,
});

const account = (over: Partial<Account>): Account => ({
  id: 'acc-1',
  name: 'Card A',
  kind: 'credit',
  balance: -1000,
  apr: 18,
  source: 'manual',
  ...over,
});

const threeDebts: Debt[] = [
  debt({ id: 'a', name: 'Card A', balance: 2000, apr: 24, minPayment: 40 }),
  debt({ id: 'b', name: 'Card B', balance: 500, apr: 12, minPayment: 25 }),
  debt({ id: 'c', name: 'Store Card', balance: 1000, apr: 18, minPayment: 30 }),
];

describe('addMonths', () => {
  it('rolls over year boundaries in both directions', () => {
    expect(addMonths('2026-11', 1)).toBe('2026-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('rejects a malformed month', () => {
    expect(() => addMonths('2026-13', 0)).toThrow();
    expect(() => addMonths('2026-1', 0)).toThrow();
  });
});

describe('simulatePayoff single debt', () => {
  it('matches the closed-form amortisation', () => {
    // 1200 at 1%/month, 200 a month: n = -ln(1 - rB/P) / ln(1 + r) = 6.22, so 7 payments.
    // Balance after 6 payments = B(1+r)^6 - P((1+r)^6 - 1)/r = 43.4211687; the 7th
    // payment clears that plus one more month of interest.
    const r = 0.01;
    const n = Math.ceil(-Math.log(1 - (r * 1200) / 200) / Math.log(1 + r));
    const after6 = 1200 * (1 + r) ** 6 - (200 * ((1 + r) ** 6 - 1)) / r;
    const lastPayment = after6 * (1 + r);
    const expectedInterest = 6 * 200 + lastPayment - 1200;

    const plan = simulatePayoff([debt({ balance: 1200, apr: 12, minPayment: 25 })], 200, '2026-11');
    expect(plan.feasible).toBe(true);
    expect(plan.months).toBe(n);
    expect(plan.months).toBe(7);
    expect(Math.abs(plan.totalInterest - expectedInterest)).toBeLessThanOrEqual(0.01);
    expect(plan.totalPaid).toBeCloseTo(1200 + plan.totalInterest, 2);
    expect(plan.payoffMonth.a).toBe('2027-05');
    expect(plan.finalMonth).toBe('2027-05');
    expect(plan.schedule[0]?.month).toBe('2026-11');
    expect(plan.schedule.at(-1)?.debts[0]?.balance).toBe(0);
  });

  it('charges one month of interest then pays it in full when the budget exceeds the balance', () => {
    const plan = simulatePayoff([debt({ balance: 100, apr: 12 })], 500, '2026-11');
    expect(plan.months).toBe(1);
    expect(plan.totalInterest).toBe(1);
    expect(plan.totalPaid).toBe(101);
  });
});

describe('strategies', () => {
  it('avalanche clears the highest APR first', () => {
    const plan = simulatePayoff(threeDebts, 400, '2026-11', 'avalanche');
    expect(plan.feasible).toBe(true);
    const a = plan.payoffMonth.a!;
    const b = plan.payoffMonth.b!;
    expect(a < b).toBe(true);
    expect(plan.schedule[0]?.debts.find((d) => d.id === 'a')?.payment).toBeGreaterThan(40);
    expect(plan.schedule[0]?.debts.find((d) => d.id === 'b')?.payment).toBe(25);
  });

  it('snowball clears the smallest balance first', () => {
    const plan = simulatePayoff(threeDebts, 400, '2026-11', 'snowball');
    expect(plan.feasible).toBe(true);
    const a = plan.payoffMonth.a!;
    const b = plan.payoffMonth.b!;
    expect(b < a).toBe(true);
    expect(plan.schedule[0]?.debts.find((d) => d.id === 'b')?.payment).toBeGreaterThan(25);
    expect(plan.schedule[0]?.debts.find((d) => d.id === 'a')?.payment).toBe(40);
  });

  it('avalanche costs no more interest than snowball', () => {
    const avalanche = simulatePayoff(threeDebts, 400, '2026-11', 'avalanche');
    const snowball = simulatePayoff(threeDebts, 400, '2026-11', 'snowball');
    expect(avalanche.totalInterest).toBeLessThan(snowball.totalInterest);
  });

  it('defaults to avalanche', () => {
    expect(simulatePayoff(threeDebts, 400, '2026-11').strategy).toBe('avalanche');
  });

  it('breaks an APR tie in favour of the smaller balance', () => {
    const tied = [
      debt({ id: 'big', balance: 2000, apr: 20, minPayment: 40 }),
      debt({ id: 'small', balance: 600, apr: 20, minPayment: 25 }),
    ];
    const plan = simulatePayoff(tied, 300, '2026-11');
    expect(plan.schedule[0]?.debts.find((d) => d.id === 'small')?.payment).toBeGreaterThan(25);
    expect(plan.schedule[0]?.debts.find((d) => d.id === 'big')?.payment).toBe(40);
  });
});

describe('rollover', () => {
  it('moves a cleared debt\'s minimum onto the next target', () => {
    const debts = [
      debt({ id: 'a', balance: 1000, apr: 20, minPayment: 30 }),
      debt({ id: 'b', balance: 100, apr: 5, minPayment: 50 }),
    ];
    const plan = simulatePayoff(debts, 300, '2026-11');
    expect(plan.feasible).toBe(true);
    const bClears = plan.schedule.findIndex((r) => r.debts.find((d) => d.id === 'b')?.balance === 0);
    expect(bClears).toBeGreaterThanOrEqual(0);
    expect(plan.payoffMonth.b).toBe(plan.schedule[bClears]?.month);

    const before = plan.schedule[0]!;
    expect(before.debts.find((d) => d.id === 'b')?.payment).toBe(50);
    expect(before.debts.find((d) => d.id === 'a')?.payment).toBe(250);

    const after = plan.schedule[bClears + 1];
    if (after) {
      expect(after.debts.find((d) => d.id === 'b')?.payment).toBe(0);
      const a = after.debts.find((d) => d.id === 'a')!;
      const aBalanceBefore = plan.schedule[bClears]!.debts.find((d) => d.id === 'a')!.balance;
      expect(a.payment).toBe(Math.min(300, Math.round((aBalanceBefore + a.interest) * 100) / 100));
    }
  });

  it('spends the full budget every month until the last', () => {
    const plan = simulatePayoff(threeDebts, 400, '2026-11');
    for (const row of plan.schedule.slice(0, -1)) {
      const paid = row.debts.reduce((s, d) => s + d.payment, 0);
      expect(paid).toBeCloseTo(400, 2);
    }
  });
});

describe('infeasible plans', () => {
  it('flags a budget below the minimums without simulating', () => {
    const plan = simulatePayoff(threeDebts, 50, '2026-11');
    expect(plan.feasible).toBe(false);
    expect(plan.months).toBe(0);
    expect(plan.schedule).toEqual([]);
    expect(plan.finalMonth).toBeNull();
    expect(plan.payoffMonth.a).toBeNull();
  });

  it('flags negative amortisation instead of looping', () => {
    // 10000 at 24% accrues 200 a month; paying 150 never shrinks it.
    const plan = simulatePayoff([debt({ balance: 10000, apr: 24, minPayment: 100 })], 150, '2026-11');
    expect(plan.feasible).toBe(false);
    expect(plan.months).toBeLessThan(5);
    expect(plan.finalMonth).toBeNull();
  });
});

describe('edge balances', () => {
  it('pays a zero-APR debt with no interest', () => {
    const plan = simulatePayoff([debt({ balance: 1000, apr: 0, minPayment: 50 })], 250, '2026-11');
    expect(plan.feasible).toBe(true);
    expect(plan.months).toBe(4);
    expect(plan.totalInterest).toBe(0);
    expect(plan.totalPaid).toBe(1000);
    expect(plan.payoffMonth.a).toBe('2027-02');
  });

  it('treats an already-zero balance as paid at the start month', () => {
    const plan = simulatePayoff([debt({ balance: 0 })], 100, '2026-11');
    expect(plan.feasible).toBe(true);
    expect(plan.months).toBe(0);
    expect(plan.totalPaid).toBe(0);
    expect(plan.payoffMonth.a).toBe('2026-11');
    expect(plan.finalMonth).toBe('2026-11');
    expect(plan.schedule).toEqual([]);
  });

  it('is feasible with no debts at all', () => {
    const plan = simulatePayoff([], 100, '2026-11');
    expect(plan.feasible).toBe(true);
    expect(plan.months).toBe(0);
  });

  it('keeps money in whole cents', () => {
    const plan = simulatePayoff([debt({ balance: 1234.56, apr: 19.99, minPayment: 40 })], 123.45, '2026-11');
    for (const row of plan.schedule) {
      for (const d of row.debts) {
        for (const v of [d.balance, d.interest, d.payment]) {
          expect(Math.abs(Math.round(v * 100) - v * 100)).toBeLessThan(1e-6);
        }
      }
    }
  });
});

describe('defaultMinPayment', () => {
  it('floors at 25 dollars', () => {
    expect(defaultMinPayment(500, 20)).toBe(25);
  });

  it('is 1% of balance plus a month of interest above the floor', () => {
    // 1% of 10000 = 100, interest 10000 * 12% / 12 = 100.
    expect(defaultMinPayment(10000, 12)).toBe(200);
  });
});

describe('debtsFromAccounts', () => {
  it('converts credit and loan accounts with negative balances', () => {
    const { debts, warnings } = debtsFromAccounts([
      account({ id: 'c1', name: 'Card A', kind: 'credit', balance: -10000, apr: 12 }),
      account({ id: 'l1', name: 'Auto Loan', kind: 'loan', balance: -5000, apr: 6 }),
    ]);
    expect(warnings).toEqual([]);
    expect(debts).toEqual([
      { id: 'c1', name: 'Card A', balance: 10000, apr: 12, minPayment: 200 },
      { id: 'l1', name: 'Auto Loan', balance: 5000, apr: 6, minPayment: 75 },
    ]);
  });

  it('skips assets, other kinds and non-negative balances', () => {
    const { debts } = debtsFromAccounts([
      account({ id: 'k', kind: 'checking', balance: -50 }),
      account({ id: 's', kind: 'savings', balance: 900 }),
      account({ id: 'z', kind: 'credit', balance: 0 }),
      account({ id: 'p', kind: 'credit', balance: 40 }),
    ]);
    expect(debts).toEqual([]);
  });

  it('assumes 0% and warns when the APR is missing', () => {
    const { debts, warnings } = debtsFromAccounts([
      account({ id: 'c1', name: 'Store Card', balance: -800, apr: undefined }),
    ]);
    expect(debts).toHaveLength(1);
    expect(debts[0]?.apr).toBe(0);
    expect(debts[0]?.balance).toBe(800);
    expect(warnings).toEqual(['Store Card: no APR on record, assumed 0%']);
  });
});

describe('runScenarios', () => {
  it('returns one summary per budget, in order, with higher budgets finishing sooner', () => {
    const rows = runScenarios(threeDebts, [300, 500, 800], '2026-11');
    expect(rows.map((r) => r.budget)).toEqual([300, 500, 800]);
    expect(rows.every((r) => r.feasible)).toBe(true);
    expect(rows[0]!.months).toBeGreaterThan(rows[1]!.months);
    expect(rows[1]!.months).toBeGreaterThan(rows[2]!.months);
    expect(rows[0]!.totalInterest).toBeGreaterThan(rows[2]!.totalInterest);
  });

  it('marks an underfunded budget infeasible without dropping the others', () => {
    const rows = runScenarios(threeDebts, [50, 500], '2026-11');
    expect(rows[0]?.feasible).toBe(false);
    expect(rows[1]?.feasible).toBe(true);
  });
});

describe('simulatePayoff input validation', () => {
  it('rejects a non-finite or negative budget', () => {
    expect(() => simulatePayoff([debt({})], Number.NaN, '2026-11')).toThrow(RangeError);
    expect(() => simulatePayoff([debt({})], Number.POSITIVE_INFINITY, '2026-11')).toThrow(RangeError);
    expect(() => simulatePayoff([debt({})], -1, '2026-11')).toThrow(RangeError);
  });

  it('rejects a debt with a non-finite field or a negative APR', () => {
    expect(() => simulatePayoff([debt({ balance: Number.NaN })], 200, '2026-11')).toThrow(RangeError);
    expect(() => simulatePayoff([debt({ apr: Number.NaN })], 200, '2026-11')).toThrow(RangeError);
    expect(() => simulatePayoff([debt({ minPayment: Number.NaN })], 200, '2026-11')).toThrow(RangeError);
    expect(() => simulatePayoff([debt({ apr: -1 })], 200, '2026-11')).toThrow(RangeError);
  });

  it('rejects duplicate debt ids', () => {
    expect(() =>
      simulatePayoff([debt({ id: 'x' }), debt({ id: 'x', name: 'Card B' })], 400, '2026-11'),
    ).toThrow('Duplicate debt id');
  });
});