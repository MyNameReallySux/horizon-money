import type { Paycheck } from './contract.ts';

/**
 * Past-due paychecks the dashboard calls missed. With a reconciled ledger (entries carry a
 * `status`) only `missed` slots count: a `stub-only` slot is not an error, since some deposits
 * land in accounts Monarch cannot see. Without statuses it falls back to past-due slots that
 * never received a deposit. `today` is a local `YYYY-MM-DD`.
 */
export function countMissed(paychecks: Paycheck[], today: string): number {
  if (paychecks.some((p) => p.status !== undefined)) {
    return paychecks.filter((p) => p.status === 'missed' && p.expectedDate < today).length;
  }
  return paychecks.filter((p) => p.receivedDate === null && p.expectedDate < today).length;
}
