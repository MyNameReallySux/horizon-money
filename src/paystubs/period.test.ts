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

  describe('header-then-values table', () => {
    const header = 'Employee | Id | Employee | Name | Check | Date | Period | Start | Period | End | Check | No';

    it('maps dashed dates to labels by header order', () => {
      const text = `${header}\n000000 | Fake | Person | 01-17-2025 | 01-01-2025 | 01-14-2025 | 0000`;
      expect(parsePayPeriod(text)).toEqual(JAN);
    });

    it('follows the label order when the columns are arranged differently', () => {
      const text = 'Period End | Check Date | Period Start\n01-14-2025 | 01-17-2025 | 01-01-2025';
      expect(parsePayPeriod(text)).toEqual(JAN);
    });

    it('skips a short row without dates between the header and its values', () => {
      const text = `${header}\nA | 7\nab0000 | Fake | Person | 01-17-2025 | 01-01-2025 | 01-14-2025 | 0000`;
      expect(parsePayPeriod(text)).toEqual(JAN);
    });

    it('does not look past the first row that has dates', () => {
      const text = `${header}\nA | 7\nab0000 | 01-01-2025 | 01-14-2025\nab0000 | 01-17-2025 | 01-01-2025 | 01-14-2025`;
      expect(parsePayPeriod(text)).toBeNull();
    });

    it('reads the table among other lines', () => {
      const text = `Fake Company\n${header}\n\n123 | Fake Name | 02-07-2025 | 01-20-2025 | 02-02-2025 | 99\nGross 1,000.00`;
      expect(parsePayPeriod(text)).toEqual({ start: '2025-01-20', end: '2025-02-02' });
    });

    it('gives up when the value row has a different number of dates than labels', () => {
      expect(parsePayPeriod(`${header}\n000000 | Fake | Person | 01-01-2025 | 01-14-2025`)).toBeNull();
    });
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
