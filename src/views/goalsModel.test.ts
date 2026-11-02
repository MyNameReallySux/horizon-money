import { describe, expect, it } from 'vitest';
import { SNAPSHOT_VERSION, type Goal, type Snapshot } from '../data/contract';
import { estimateWeeklySpend, goalStatus, weeklyGoalProgress } from './goalsModel';

function snapshot(goals: Goal[]): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: '2030-01-10T00:00:00Z',
    source: 'fixture',
    currency: 'USD',
    accounts: [],
    cashflowMonthly: [],
    spendingByCategory: [
      { month: '2030-01', group: 'Food', category: 'Groceries', amount: -100 },
      { month: '2030-01', group: 'Food', category: 'Dining', amount: -40 },
      { month: '2030-01', group: 'Fun', category: 'Games', amount: -10 },
      { month: '2029-12', group: 'Food', category: 'Groceries', amount: -999 },
    ],
    recurring: [],
    paychecks: [],
    goals,
    coverage: { hiddenInstitutions: [] },
  };
}

const goal = (over: Partial<Goal>): Goal => ({
  id: 'g',
  name: 'Goal',
  period: 'week',
  metric: 'spending',
  target: 100,
  direction: 'max',
  ...over,
});

describe('estimateWeeklySpend', () => {
  it('pro-rates month-to-date spend to a 7-day week', () => {
    expect(estimateWeeklySpend(snapshot([]), 'category:Groceries', '2030-01-10')).toBeCloseTo(70);
    expect(estimateWeeklySpend(snapshot([]), 'spending', '2030-01-10')).toBeCloseTo(105);
  });

  it('matches groups and ignores other months', () => {
    expect(estimateWeeklySpend(snapshot([]), 'group:Food', '2030-01-07')).toBeCloseTo(140);
  });

  it('returns null for unknown metrics and months without matching rows', () => {
    expect(estimateWeeklySpend(snapshot([]), 'debt-paydown', '2030-01-10')).toBeNull();
    expect(estimateWeeklySpend(snapshot([]), 'category:Nope', '2030-01-10')).toBeNull();
    expect(estimateWeeklySpend(snapshot([]), 'spending', '2030-02-10')).toBeNull();
  });
});

describe('goalStatus', () => {
  it('treats caps as good below 90%, near to 100%, bad over', () => {
    expect(goalStatus(0.5, 'max')).toBe('good');
    expect(goalStatus(0.9, 'max')).toBe('near');
    expect(goalStatus(1, 'max')).toBe('near');
    expect(goalStatus(1.01, 'max')).toBe('bad');
  });

  it('reverses for floors', () => {
    expect(goalStatus(1, 'min')).toBe('good');
    expect(goalStatus(0.95, 'min')).toBe('near');
    expect(goalStatus(0.5, 'min')).toBe('bad');
  });
});

describe('weeklyGoalProgress', () => {
  it('returns nothing without goals', () => {
    expect(weeklyGoalProgress(snapshot([]), '2030-01-10')).toEqual([]);
  });

  it('keeps only weekly goals and computes ratio and status', () => {
    const rows = weeklyGoalProgress(
      snapshot([
        goal({ id: 'a', metric: 'category:Groceries', target: 100 }),
        goal({ id: 'b', period: 'month' }),
        goal({ id: 'c', metric: 'category:Groceries', target: 50, stretch: 40 }),
        goal({ id: 'd', metric: 'category:Groceries', target: 70, direction: 'min' }),
      ]),
      '2030-01-10',
    );
    expect(rows.map((r) => r.goal.id)).toEqual(['a', 'c', 'd']);
    expect(rows[0]).toMatchObject({ status: 'good', direction: 'max' });
    expect(rows[0]?.ratio).toBeCloseTo(0.7);
    expect(rows[1]).toMatchObject({ status: 'bad' });
    expect(rows[1]?.goal.stretch).toBe(40);
    expect(rows[2]).toMatchObject({ status: 'good', direction: 'min' });
  });

  it('defaults a missing direction to min', () => {
    const [row] = weeklyGoalProgress(snapshot([goal({ direction: undefined })]), '2030-01-10');
    expect(row?.direction).toBe('min');
  });

  it('gives no data for unknown metrics', () => {
    const [row] = weeklyGoalProgress(snapshot([goal({ metric: 'emergency-fund' })]), '2030-01-10');
    expect(row).toMatchObject({ actual: null, ratio: null, status: null });
  });
});
