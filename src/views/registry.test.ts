import { describe, expect, it } from 'vitest';
import { viewIdFromHash, views } from './registry';

const list = [{ id: 'overview' }, { id: 'debt' }];

describe('viewIdFromHash', () => {
  it('selects a known view with or without the leading #', () => {
    expect(viewIdFromHash('#debt', list)).toBe('debt');
    expect(viewIdFromHash('debt', list)).toBe('debt');
  });

  it('falls back to the first view for empty or unknown hashes', () => {
    expect(viewIdFromHash('', list)).toBe('overview');
    expect(viewIdFromHash('#', list)).toBe('overview');
    expect(viewIdFromHash('#nope', list)).toBe('overview');
  });

  it('returns an empty id for an empty list', () => {
    expect(viewIdFromHash('#x', [])).toBe('');
  });
});

describe('views registry', () => {
  it('has unique, non-empty ids and labels', () => {
    const ids = views.map((v) => v.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(views.every((v) => v.label.length > 0)).toBe(true);
  });
});
