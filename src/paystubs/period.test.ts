import { describe, expect, it } from 'vitest';
import { parsePayPeriod } from './period.ts';

const JAN = { start: '2025-01-01', end: '2025-01-14' };

describe('parsePayPeriod', () => {
  it.each([
    ['a labelled range', 'Pay Period: 01/01/2025 - 01/14/2025'],
    ['a to range', 'PAY PERIOD 1/1/25 to 1/14/25'],
    ['an en dash range', 'Pay Period 01/01/2025 – 01/14/2025'],
    ['an ISO range', 'Period: 2025-01-01 through 2025-01-14'],
    ['a whitespace-only pay period pair', 'Pay Period 01/01/2025 01/14/2025'],
    ['beginning and ending labels', 'Period Beginning: 01/01/2025\nPeriod Ending: 01/14/2025'],
    ['start and end labels', 'Period Start 1/1/2025   Period End 1/14/2025'],
    ['begin and end date labels', 'Begin Date: 2025-01-01 End Date: 2025-01-14'],
    ['from and to', 'From 01/01/2025 To 01/14/2025'],
    ['a label header row followed by values', 'Period Beginning Period Ending Check Date\n01/01/2025 01/14/2025 01/17/2025'],
  ])('reads %s', (_name, text) => {
    expect(parsePayPeriod(`Employee   Gross  ${text}  Net`)).toEqual(JAN);
  });

  it('does not mistake the check date after a period end for a range', () => {
    expect(parsePayPeriod('Period Ending: 01/14/2025 Check Date: 01/17/2025')).toBeNull();
  });

  it('ignores a check date next to the labelled halves', () => {
    expect(parsePayPeriod('Check Date 01/17/2025 Period Beginning 01/01/2025 Period Ending 01/14/2025')).toEqual(JAN);
  });

  it('rejects text without a period', () => {
    expect(parsePayPeriod('')).toBeNull();
    expect(parsePayPeriod('Check Date 01/17/2025 Net Pay')).toBeNull();
  });

  it('rejects a start after the end', () => {
    expect(parsePayPeriod('Pay Period: 01/14/2025 - 01/01/2025')).toBeNull();
  });

  it('rejects a span over 31 days and accepts exactly 31', () => {
    expect(parsePayPeriod('Pay Period: 01/01/2025 - 02/01/2025')).toBeNull();
    expect(parsePayPeriod('Pay Period: 01/01/2025 - 01/31/2025')).toEqual({ start: '2025-01-01', end: '2025-01-31' });
  });

  it('rejects dates that are not on the calendar', () => {
    expect(parsePayPeriod('Pay Period: 02/30/2025 - 03/10/2025')).toBeNull();
    expect(parsePayPeriod('Pay Period: 13/01/2025 - 13/10/2025')).toBeNull();
  });
});
