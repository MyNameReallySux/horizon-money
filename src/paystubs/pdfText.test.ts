import { describe, expect, it } from 'vitest';
import { linesFromTextItems, type TextItem } from './pdfText.ts';

const item = (str: string, x: number, y: number, width?: number): TextItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  ...(width === undefined ? {} : { width }),
});

describe('linesFromTextItems', () => {
  it('collapses single-character items into words split by whitespace items', () => {
    const items = [...'Check', ' ', ...'Date'].map((c, i) => item(c, 10 + i * 6, 100));
    expect(linesFromTextItems(items)).toEqual(['Check | Date']);
  });

  it('splits words on a horizontal gap when widths are known', () => {
    const letters = [...'Period'].map((c, i) => item(c, 10 + i * 6, 100, 6));
    const next = [...'End'].map((c, i) => item(c, 80 + i * 6, 100, 6));
    expect(linesFromTextItems([...letters, ...next])).toEqual(['Period | End']);
  });

  it('orders rows top first and cells left to right regardless of input order', () => {
    const lines = linesFromTextItems([
      item('01-14-2025', 200, 80),
      item('Fake Person', 100, 80),
      item('Name', 100, 100),
      item('Period End', 200, 100),
    ]);
    expect(lines).toEqual(['Name | Period End', 'Fake Person | 01-14-2025']);
  });

  it('groups items whose y differs by sub-point noise and drops empty rows', () => {
    const lines = linesFromTextItems([item('A1', 10, 100.2), item('B2', 50, 99.8), item(' ', 5, 40)]);
    expect(lines).toEqual(['A1 | B2']);
  });
});
