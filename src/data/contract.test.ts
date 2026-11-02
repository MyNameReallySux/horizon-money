import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/demo.snapshot.json';
import { isSnapshot } from './contract';

describe('isSnapshot', () => {
  it('accepts the bundled fixture', () => {
    expect(isSnapshot(fixture)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'snapshot'],
    ['an empty object', {}],
    ['a wrong version', { ...fixture, version: 1 }],
    ['a missing coverage', { ...fixture, coverage: undefined }],
    ['a coverage without institutions', { ...fixture, coverage: {} }],
    ['an unknown source', { ...fixture, source: 'csv' }],
    ['a non-USD currency', { ...fixture, currency: 'EUR' }],
    ['a missing array', { ...fixture, goals: undefined }],
    ['a non-array field', { ...fixture, accounts: {} }],
  ])('rejects %s', (_label, value) => {
    expect(isSnapshot(value)).toBe(false);
  });
});
