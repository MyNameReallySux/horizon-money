import type { Goal, Snapshot } from '../data/contract';

/** How a goal stands against its target: `good` is on track, `near` is within 10%, `bad` is off track. */
export type GoalStatus = 'good' | 'near' | 'bad';

/** One weekly goal with its estimated actual and derived progress. */
export interface GoalProgress {
  goal: Goal;
  /** `max` unless the goal says `min` (Monarch goals carry no direction and are floors, so they are `min`). */
  direction: 'max' | 'min';
  /** Estimated dollars for the current week, or null when the metric has no usable actual. */
  actual: number | null;
  /** `actual / target`, or null without an actual. May exceed 1. */
  ratio: number | null;
  /** Null without an actual. */
  status: GoalStatus | null;
}

/**
 * The date the snapshot's month-to-date spend is as of (`YYYY-MM-DD`). Pace must use this, not
 * the wall clock: a stale snapshot paced against a later date understates the weekly rate.
 */
export function snapshotDate(snapshot: Snapshot): string {
  return snapshot.generatedAt.slice(0, 10);
}

/**
 * Estimated spend for a week, from the current month's spend so far.
 *
 * The snapshot has monthly spending only, so the week is month-to-date spend divided by the
 * days elapsed in the month, times 7. `metric` is `spending` (everything), `category:<name>`
 * or `group:<name>`. Returns null for any other metric, or when no spending row matches in the
 * month of `today`. Refunds can push the total positive; spend is floored at 0.
 *
 * @param today ISO date `YYYY-MM-DD`, injected so the result is deterministic.
 */
export function estimateWeeklySpend(snapshot: Snapshot, metric: string, today: string): number | null {
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  if (!Number.isInteger(day) || day < 1) return null;

  let matches: (row: Snapshot['spendingByCategory'][number]) => boolean;
  if (metric === 'spending') matches = () => true;
  else if (metric.startsWith('category:')) {
    const name = metric.slice('category:'.length);
    matches = (row) => row.category === name;
  } else if (metric.startsWith('group:')) {
    const name = metric.slice('group:'.length);
    matches = (row) => row.group === name;
  } else return null;

  const rows = snapshot.spendingByCategory.filter((row) => row.month === month && matches(row));
  if (rows.length === 0) return null;
  const monthToDate = Math.max(0, -rows.reduce((sum, row) => sum + row.amount, 0));
  return (monthToDate / day) * 7;
}

/** Status for a ratio of actual to target: caps (`max`) want it low, floors (`min`) want it high. */
export function goalStatus(ratio: number, direction: 'max' | 'min'): GoalStatus {
  if (direction === 'max') {
    if (ratio > 1) return 'bad';
    return ratio >= 0.9 ? 'near' : 'good';
  }
  if (ratio >= 1) return 'good';
  return ratio >= 0.9 ? 'near' : 'bad';
}

/**
 * Progress for every weekly goal in the snapshot, in snapshot order.
 *
 * Actuals are estimated from month-to-date spending (see `estimateWeeklySpend`); metrics with no
 * usable actual get null actual, ratio and status ("no data yet" in the UI).
 *
 * @param today ISO date `YYYY-MM-DD`.
 */
export function weeklyGoalProgress(snapshot: Snapshot, today: string): GoalProgress[] {
  return snapshot.goals
    .filter((goal) => goal.period === 'week')
    .map((goal) => {
      const direction = goal.direction ?? 'min';
      const actual = estimateWeeklySpend(snapshot, goal.metric, today);
      if (actual === null || !(goal.target > 0)) {
        return { goal, direction, actual: null, ratio: null, status: null };
      }
      const ratio = actual / goal.target;
      return { goal, direction, actual, ratio, status: goalStatus(ratio, direction) };
    });
}
