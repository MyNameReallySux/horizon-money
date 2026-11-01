import type { RecurringFrequency, RecurringItem } from '../data/contract.ts';
import { cents, isFiniteNumber, isRecord, type Warn } from './raw.ts';

/** Maps Monarch's frequency strings onto {@link RecurringFrequency}; null for anything else. */
export function mapFrequency(value: unknown): RecurringFrequency | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase().replace(/[^a-z]/g, '')) {
    case 'weekly':
      return 'weekly';
    case 'biweekly':
    case 'everyotherweek':
    case 'everytwoweeks':
      return 'biweekly';
    case 'monthly':
      return 'monthly';
    case 'quarterly':
      return 'quarterly';
    case 'yearly':
    case 'annually':
    case 'annual':
      return 'yearly';
    default:
      return null;
  }
}

/**
 * Maps GetRecurring expense streams. Amounts are made negative since these are bills; streams
 * with an unrecognised frequency are skipped and counted.
 */
export function mapRecurring(raw: unknown, warn: Warn): RecurringItem[] {
  const streams = isRecord(raw) && isRecord(raw.recurring_expense_streams)
    ? raw.recurring_expense_streams.recurring_transaction_streams
    : undefined;
  if (!Array.isArray(streams)) throw new Error('recurring.json: expected recurring_expense_streams.recurring_transaction_streams');

  const out: RecurringItem[] = [];
  let unknownFrequency = 0;
  let malformed = 0;
  for (const s of streams) {
    if (!isRecord(s)) continue;
    if (typeof s.name !== 'string' || !isFiniteNumber(s.amount)) {
      malformed++;
      continue;
    }
    const frequency = mapFrequency(s.frequency);
    if (frequency === null) {
      unknownFrequency++;
      continue;
    }
    out.push({
      name: s.name,
      amount: cents(-Math.abs(s.amount)),
      frequency,
      category: typeof s.category === 'string' ? s.category : 'Uncategorized',
      nextDate: typeof s.next_forecasted_date === 'string' ? s.next_forecasted_date.slice(0, 10) : '',
    });
  }
  if (unknownFrequency > 0) warn(`skipped ${unknownFrequency} recurring stream(s) with an unknown frequency`);
  if (malformed > 0) warn(`skipped ${malformed} recurring stream(s) with a missing name or amount`);
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name));
}
