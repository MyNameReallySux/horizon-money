import type { Goal } from '../data/contract.ts';
import { isFiniteNumber, recordsAt, type Warn } from './raw.ts';

/**
 * Maps GetGoals to year-period `savings-goal` goals targeting each Monarch goal's
 * `target_amount`. Goals without a positive target are skipped and counted.
 */
export function mapGoals(raw: unknown, warn: Warn): Goal[] {
  const out: Goal[] = [];
  let skipped = 0;
  for (const g of recordsAt(raw, ['goals'], 'goals.json')) {
    const hasId = typeof g.id === 'string' || typeof g.id === 'number';
    if (!hasId || typeof g.name !== 'string' || !isFiniteNumber(g.target_amount) || g.target_amount <= 0) {
      skipped++;
      continue;
    }
    out.push({
      id: String(g.id),
      name: g.name,
      period: 'year',
      metric: 'savings-goal',
      target: g.target_amount,
    });
  }
  if (skipped > 0) warn(`skipped ${skipped} goal(s) with a missing id, name or positive target`);
  return out;
}
