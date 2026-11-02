import { describe, expect, it } from 'vitest';
import { maskProbeLine } from './probeMask.ts';

describe('maskProbeLine', () => {
  it('masks non-ASCII names to one x per word', () => {
    expect(maskProbeLine('José Núñez')).toBe('x x');
  });

  it('masks non-ASCII digits', () => {
    expect(maskProbeLine('Pay Date ٣')).toBe('Pay Date #');
  });

  it('keeps label words and masks ASCII digits', () => {
    expect(maskProbeLine('Period Start 01/01/2025')).toBe('Period Start ##/##/####');
  });
});
