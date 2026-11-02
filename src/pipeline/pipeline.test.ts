import { describe, expect, it } from 'vitest';
import accountsRaw from '../fixtures/raw/accounts.raw.json';
import categoriesRaw from '../fixtures/raw/categories.raw.json';
import cashflowRaw from '../fixtures/raw/cashflow-monthly.raw.json';
import goalsRaw from '../fixtures/raw/goals.raw.json';
import paychecksRaw from '../fixtures/raw/paychecks.raw.json';
import recurringRaw from '../fixtures/raw/recurring.raw.json';
import spendingRaw from '../fixtures/raw/spending-by-category.raw.json';
import { isSnapshot, type PaySchedule } from '../data/contract.ts';
import type { ManualEntry } from '../data/manual.ts';
import { mapAccountKind, mapAccounts } from './accounts.ts';
import { buildSnapshot, mergeManualAccounts } from './build.ts';
import { DEFAULT_CASHFLOW_OPTIONS, mapCashflow, mapSpending } from './cashflow.ts';
import { mapGoals } from './goals.ts';
import { buildPaychecks, mapDeposits } from './paychecks.ts';
import { mapFrequency, mapRecurring } from './recurring.ts';
import { unwrapMcp } from './raw.ts';

const noWarn = () => {};
const collect = () => {
  const messages: string[] = [];
  return { messages, warn: (m: string) => messages.push(m) };
};

describe('unwrapMcp', () => {
  it('unwraps the {"result": "<json>"} envelope', () => {
    expect(unwrapMcp({ result: JSON.stringify({ accounts: [1] }) })).toEqual({ accounts: [1] });
  });

  it('passes through an unwrapped payload', () => {
    const payload = { accounts: [], result: 'kept because other keys exist' };
    expect(unwrapMcp(payload)).toBe(payload);
  });
});

describe('mapAccounts', () => {
  const { accounts, hiddenInstitutions } = mapAccounts(accountsRaw, noWarn);
  const byId = (id: string) => accounts.find((a) => a.id === id);

  it.each([
    ['Checking', 'checking'],
    ['Savings', 'savings'],
    ['Credit Card', 'credit'],
    ['Mortgage', 'loan'],
    ['Auto Loan', 'loan'],
    ['401k', 'investment'],
    ['Brokerage', 'investment'],
    ['Cryptocurrency', 'investment'],
    ['Primary Home', 'property'],
    ['Car', 'property'],
    ['Other', 'other'],
    ['Something New', 'other'],
  ])('maps type %s to %s', (type, kind) => {
    expect(mapAccountKind(type)).toBe(kind);
  });

  it('marks every account as monarch-sourced', () => {
    expect(accounts).toHaveLength(10);
    expect(accounts.every((a) => a.source === 'monarch')).toBe(true);
  });

  it('keeps the percent interest rate as apr and omits it otherwise', () => {
    expect(byId('acct-03')?.apr).toBe(21.99);
    expect(byId('acct-05')?.apr).toBe(6.25);
    expect(byId('acct-01')).not.toHaveProperty('apr');
  });

  it('forces liabilities negative and leaves assets alone', () => {
    expect(byId('acct-04')?.balance).toBe(-1800);
    expect(byId('acct-03')?.balance).toBe(-3200);
    expect(byId('acct-01')?.balance).toBe(4200.5);
  });

  it('reports hidden institutions', () => {
    expect(hiddenInstitutions).toEqual(['Sample Credit Union', 'Sample Brokerage House']);
  });

  it('returns no hidden institutions when the block is absent', () => {
    expect(mapAccounts({ accounts: [] }, noWarn).hiddenInstitutions).toEqual([]);
  });

  it('throws when accounts is not an array', () => {
    expect(() => mapAccounts({ accounts: 3 }, noWarn)).toThrow(/accounts\.json/);
  });
});

describe('mapCashflow', () => {
  const { messages, warn } = collect();
  const months = mapCashflow(cashflowRaw, DEFAULT_CASHFLOW_OPTIONS, warn);

  it('groups by month, sorted, trimming the day', () => {
    expect(months.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
  });

  it('sums income groups as income and the rest as net expense', () => {
    expect(months[0]).toEqual({ month: '2026-08', income: 6400, expense: -2625 });
    expect(months[1]).toEqual({ month: '2026-09', income: 6500, expense: -2700.25 });
  });

  it('excludes investment and transfer groups from both sides', () => {
    expect(months[1]?.expense).toBe(-2700.25);
  });

  it('counts rows it cannot read', () => {
    expect(messages).toEqual(['skipped 1 cash-flow row(s) with missing month, group or amount']);
  });

  it('honours a custom income list', () => {
    const custom = mapCashflow(
      cashflowRaw,
      { incomeGroups: ['Income'], excludedGroups: ['Investment', 'Transfers'] },
      noWarn,
    );
    expect(custom[1]).toEqual({ month: '2026-09', income: 6400, expense: -2600.25 });
  });
});

describe('mapSpending', () => {
  it('keeps expense categories with their group and drops income and transfers', () => {
    const { messages, warn } = collect();
    const rows = mapSpending(spendingRaw, categoriesRaw, warn);
    expect(rows).toEqual([
      { month: '2026-08', group: 'Food', category: 'Groceries', amount: -600 },
      { month: '2026-09', group: 'Food', category: 'Groceries', amount: -650.1 },
      { month: '2026-09', group: 'Housing', category: 'Rent', amount: -1800 },
      { month: '2026-09', group: 'Mystery', category: 'Mystery', amount: -5 },
    ]);
    expect(messages).toEqual(['1 spending row(s) have a category missing from categories.json']);
  });

  it('keeps every category under itself when categories.json is absent', () => {
    const rows = mapSpending(spendingRaw, undefined, noWarn);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.group === r.category)).toBe(true);
  });
});

describe('mapRecurring', () => {
  it.each([
    ['monthly', 'monthly'],
    ['Weekly', 'weekly'],
    ['every_two_weeks', 'biweekly'],
    ['bi-weekly', 'biweekly'],
    ['quarterly', 'quarterly'],
    ['yearly', 'yearly'],
    ['semimonthly', 'semimonthly'],
    ['semimonthly_start_mid', 'semimonthly'],
    ['semimonthly_mid_end', 'semimonthly'],
    ['semiyearly', 'semiyearly'],
    ['fortnightly', 'biweekly'],
    ['whenever_it_feels_like', null],
    [undefined, null],
  ])('maps frequency %s to %s', (input, expected) => {
    expect(mapFrequency(input)).toBe(expected);
  });

  it('maps streams as bills and skips unknown frequencies with a count', () => {
    const { messages, warn } = collect();
    const items = mapRecurring(recurringRaw, warn);
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.amount < 0)).toBe(true);
    expect(items[0]).toEqual({
      name: 'Sample Pet',
      amount: -25,
      frequency: 'weekly',
      category: 'Pets',
      nextDate: '2026-11-04',
    });
    expect(messages).toEqual(['skipped 1 recurring stream(s) with an unknown frequency']);
  });

  it('skips streams without a valid next date and counts them', () => {
    const stream = (extra: Record<string, unknown>) => ({ name: 'Sample', amount: 10, frequency: 'monthly', ...extra });
    const raw = {
      recurring_expense_streams: {
        recurring_transaction_streams: [
          stream({}),
          stream({ next_forecasted_date: null }),
          stream({ next_forecasted_date: '2026-02-31' }),
          stream({ next_forecasted_date: 'soon' }),
          stream({ next_forecasted_date: '2026-12-05T00:00:00Z' }),
        ],
      },
    };
    const { messages, warn } = collect();
    const items = mapRecurring(raw, warn);
    expect(items.map((i) => i.nextDate)).toEqual(['2026-12-05']);
    expect(messages).toEqual(['skipped 4 recurring stream(s) with a missing name, amount or next date']);
  });

  it('throws on an unexpected shape', () => {
    expect(() => mapRecurring({}, noWarn)).toThrow(/recurring\.json/);
  });
});

describe('mapGoals', () => {
  it('keeps goals with a positive target as year savings-goal goals', () => {
    const { messages, warn } = collect();
    expect(mapGoals(goalsRaw, warn)).toEqual([
      { id: 'goal-01', name: 'Sample Vacation Fund', period: 'year', metric: 'savings-goal', target: 4000 },
    ]);
    expect(messages).toHaveLength(1);
  });
});

describe('buildPaychecks', () => {
  const schedule: PaySchedule = { cadence: 'biweekly', anchorDate: '2026-09-04', expectedAmount: 3200 };

  it('aligns expected dates to the anchor, every 14 days', () => {
    const rows = buildPaychecks(schedule, [{ date: '2026-09-04', amount: 3200 }], '2026-10-31');
    expect(rows.map((r) => r.expectedDate)).toEqual(['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30']);
  });

  it('walks backwards from the anchor to the earliest deposit', () => {
    const rows = buildPaychecks(schedule, [{ date: '2026-08-07', amount: 3200 }], '2026-09-05');
    expect(rows.map((r) => r.expectedDate)).toEqual(['2026-08-07', '2026-08-21', '2026-09-04']);
  });

  it('matches within three days and not beyond', () => {
    const rows = buildPaychecks(
      schedule,
      [
        { date: '2026-09-07', amount: 3200 },
        { date: '2026-09-22', amount: 3200 },
      ],
      '2026-09-30',
    );
    expect(rows[0]).toMatchObject({ expectedDate: '2026-09-04', receivedDate: '2026-09-07' });
    expect(rows[1]).toMatchObject({ expectedDate: '2026-09-18', receivedDate: null, receivedAmount: null });
  });

  it('keeps a partial amount as the received amount', () => {
    const rows = buildPaychecks(schedule, [{ date: '2026-09-04', amount: 1600 }], '2026-09-10');
    expect(rows).toEqual([
      { expectedDate: '2026-09-04', expectedAmount: 3200, receivedDate: '2026-09-04', receivedAmount: 1600 },
    ]);
  });

  it('prefers the closest deposit when several fall in the window', () => {
    const rows = buildPaychecks(
      schedule,
      [
        { date: '2026-09-06', amount: 100 },
        { date: '2026-09-04', amount: 3200 },
      ],
      '2026-09-10',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ receivedDate: '2026-09-04', receivedAmount: 3200 });
  });

  it('excludes future dates and includes today', () => {
    expect(buildPaychecks(schedule, [], '2026-09-17')).toHaveLength(1);
    expect(buildPaychecks(schedule, [], '2026-09-18')).toHaveLength(2);
  });

  it('is empty when the anchor is in the future and there are no deposits', () => {
    expect(buildPaychecks(schedule, [], '2026-09-03')).toEqual([]);
  });

  it('builds from the raw fixture, ignoring non-positive transactions', () => {
    const rows = buildPaychecks(schedule, mapDeposits(paychecksRaw, noWarn), '2026-11-01');
    expect(rows.map((r) => [r.expectedDate, r.receivedDate, r.receivedAmount])).toEqual([
      ['2026-09-04', '2026-09-04', 3200],
      ['2026-09-18', '2026-09-17', 3200],
      ['2026-10-02', null, null],
      ['2026-10-16', '2026-10-15', 1600],
      ['2026-10-30', '2026-10-30', 3200],
    ]);
  });
});

describe('mergeManualAccounts', () => {
  const monarch = mapAccounts(accountsRaw, noWarn).accounts;
  const manual: ManualEntry = {
    version: 1,
    accounts: [
      { id: 'manual-card', name: 'Sample Club Card', kind: 'credit', balance: -500, apr: 25, asOf: '2026-10-28' },
    ],
  };

  it('appends manual accounts after Monarch ones with source and asOf', () => {
    const merged = mergeManualAccounts(monarch, manual);
    expect(merged).toHaveLength(monarch.length + 1);
    expect(merged.at(-1)).toEqual({
      id: 'manual-card',
      name: 'Sample Club Card',
      kind: 'credit',
      balance: -500,
      apr: 25,
      source: 'manual',
      asOf: '2026-10-28',
    });
  });

  it.each(['credit', 'loan'] as const)('normalises a positive manual %s balance to negative', (kind) => {
    const entry: ManualEntry = { ...manual, accounts: [{ ...manual.accounts[0]!, kind, balance: 500 }] };
    expect(mergeManualAccounts(monarch, entry).at(-1)?.balance).toBe(-500);
  });

  it('leaves a positive manual asset balance alone', () => {
    const entry: ManualEntry = { ...manual, accounts: [{ ...manual.accounts[0]!, kind: 'savings', balance: 500 }] };
    expect(mergeManualAccounts(monarch, entry).at(-1)?.balance).toBe(500);
  });

  it('throws on an id collision', () => {
    const clash: ManualEntry = { ...manual, accounts: [{ ...manual.accounts[0]!, id: 'acct-01' }] };
    expect(() => mergeManualAccounts(monarch, clash)).toThrow(/collides/);
  });
});

describe('buildSnapshot', () => {
  const now = new Date('2026-11-01T09:00:00Z');
  const manual = {
    version: 1,
    accounts: [{ id: 'manual-brokerage', name: 'Sample Brokerage', kind: 'investment', balance: 100, asOf: '2026-10-28' }],
    paySchedule: { cadence: 'biweekly', anchorDate: '2026-09-04', expectedAmount: 3200 },
  };

  it('assembles a valid snapshot from every raw section', () => {
    const { snapshot, warnings } = buildSnapshot(
      {
        accounts: accountsRaw,
        cashflowMonthly: cashflowRaw,
        spendingByCategory: spendingRaw,
        categories: categoriesRaw,
        recurring: recurringRaw,
        goals: goalsRaw,
        paychecks: paychecksRaw,
        manual,
      },
      { now },
    );
    expect(isSnapshot(snapshot)).toBe(true);
    expect(snapshot.source).toBe('monarch');
    expect(snapshot.generatedAt).toBe('2026-11-01T09:00:00.000Z');
    expect(snapshot.accounts).toHaveLength(11);
    expect(snapshot.paySchedule).toEqual(manual.paySchedule);
    expect(snapshot.paychecks).toHaveLength(5);
    expect(snapshot.coverage.hiddenInstitutions).toHaveLength(2);
    expect(warnings.every((w) => !w.includes('Sample'))).toBe(true);
  });

  it('leaves optional sections empty with a warning per missing file', () => {
    const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw }, { now });
    expect(isSnapshot(snapshot)).toBe(true);
    expect(snapshot.cashflowMonthly).toEqual([]);
    expect(snapshot.spendingByCategory).toEqual([]);
    expect(snapshot.recurring).toEqual([]);
    expect(snapshot.goals).toEqual([]);
    expect(snapshot.paychecks).toEqual([]);
    expect(snapshot).not.toHaveProperty('paySchedule');
    expect(warnings).toHaveLength(5);
  });

  it('uses the local date for today, not the UTC date', () => {
    const localEvening = new Date(2026, 8, 17, 23, 30);
    const { snapshot } = buildSnapshot({ accounts: accountsRaw, paychecks: paychecksRaw, manual }, { now: localEvening });
    const expected = snapshot.paychecks.map((p) => p.expectedDate);
    expect(expected).toContain('2026-09-04');
    expect(expected).not.toContain('2026-09-18');
  });

  it('warns that paychecks need a pay schedule', () => {
    const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, paychecks: paychecksRaw }, { now });
    expect(snapshot.paychecks).toEqual([]);
    expect(warnings).toContain('no paySchedule in manual.json; paychecks section is empty');
  });

  it('rejects a malformed manual file', () => {
    expect(() => buildSnapshot({ accounts: accountsRaw, manual: { version: 9 } }, { now })).toThrow(/manual\.json/);
  });

  it('rejects a manual id that collides with a Monarch id', () => {
    const clash = { ...manual, accounts: [{ ...manual.accounts[0]!, id: 'acct-02' }] };
    expect(() => buildSnapshot({ accounts: accountsRaw, manual: clash }, { now })).toThrow(/collides/);
  });

  describe('targets', () => {
    const cap = { id: 'week-cap', name: 'Test cap', period: 'week', metric: 'spending', target: 100, direction: 'max' };
    const floor = {
      id: 'year-fund',
      name: 'Test fund',
      period: 'year',
      metric: 'emergency-fund',
      target: 1000,
      direction: 'min',
      stretch: 1500,
      by: '2027-06-30',
    };
    const targets = { version: 1, targets: [cap, floor] };

    it('appends targets after Monarch goals, carrying direction, stretch and by', () => {
      const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, goals: goalsRaw, targets }, { now });
      expect(isSnapshot(snapshot)).toBe(true);
      expect(snapshot.goals.map((g) => g.id)).toEqual(['goal-01', 'week-cap', 'year-fund']);
      expect(snapshot.goals[1]).toEqual(cap);
      expect(snapshot.goals[2]).toEqual(floor);
      expect(warnings.some((w) => w.includes('targets.json'))).toBe(false);
    });

    it('gives a missing targets file no warning and leaves goals alone', () => {
      const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, goals: goalsRaw }, { now });
      expect(snapshot.goals.map((g) => g.id)).toEqual(['goal-01']);
      expect(warnings.some((w) => w.includes('targets.json'))).toBe(false);
    });

    it('works without a Monarch goals file', () => {
      const { snapshot } = buildSnapshot({ accounts: accountsRaw, targets }, { now });
      expect(snapshot.goals.map((g) => g.id)).toEqual(['week-cap', 'year-fund']);
    });

    it('surfaces parse warnings and drops invalid entries without throwing', () => {
      const bad = { version: 1, targets: [cap, { ...floor, target: -1 }] };
      const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, targets: bad }, { now });
      expect(snapshot.goals.map((g) => g.id)).toEqual(['week-cap']);
      expect(warnings.filter((w) => w.includes('targets.json'))).toHaveLength(1);
    });

    it('ignores a wrong-version file with a warning', () => {
      const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, targets: { version: 2, targets: [cap] } }, { now });
      expect(snapshot.goals).toEqual([]);
      expect(warnings.filter((w) => w.includes('targets.json'))).toHaveLength(1);
    });

    describe('effective window', () => {
      const withWindow = { ...targets, effective: { from: '2030-01-01', to: '2030-12-31' } };
      const on = (y: number, m: number, d: number) => ({ now: new Date(y, m - 1, d, 12) });
      const run = (t: unknown, opts: { now: Date }) =>
        buildSnapshot({ accounts: accountsRaw, goals: goalsRaw, targets: t }, opts);

      it.each([
        ['inside the window', on(2030, 6, 15)],
        ['on the first day', on(2030, 1, 1)],
        ['on the last day', on(2030, 12, 31)],
      ])('loads targets %s', (_label, opts) => {
        const { snapshot, warnings } = run(withWindow, opts);
        expect(snapshot.goals.map((g) => g.id)).toEqual(['goal-01', 'week-cap', 'year-fund']);
        expect(warnings.some((w) => w.includes('targets.json'))).toBe(false);
      });

      it.each([
        ['before', on(2029, 12, 31)],
        ['after', on(2031, 1, 1)],
      ])('skips targets and warns once when the date is %s the window', (_label, opts) => {
        const { snapshot, warnings } = run(withWindow, opts);
        expect(snapshot.goals.map((g) => g.id)).toEqual(['goal-01']);
        const mine = warnings.filter((w) => w.includes('targets.json'));
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatch(
          /not in effect on \d{4}-\d{2}-\d{2} \(effective 2030-01-01\.\.2030-12-31\); targets skipped/,
        );
        expect(mine[0]).not.toMatch(/Test|100|1000|1500/);
      });

      it('loads targets whatever the date when there is no effective range', () => {
        const { snapshot } = run(targets, on(2099, 1, 1));
        expect(snapshot.goals.map((g) => g.id)).toEqual(['goal-01', 'week-cap', 'year-fund']);
      });
    });

    it('lets a target replace a Monarch goal with the same id and warns', () => {
      const clash = { version: 1, targets: [{ ...cap, id: 'goal-01' }] };
      const { snapshot, warnings } = buildSnapshot({ accounts: accountsRaw, goals: goalsRaw, targets: clash }, { now });
      expect(snapshot.goals).toEqual([{ ...cap, id: 'goal-01' }]);
      expect(warnings.some((w) => w.includes('match a Monarch goal id'))).toBe(true);
    });
  });
});
