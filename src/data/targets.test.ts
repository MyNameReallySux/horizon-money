import { describe, expect, it } from 'vitest';
import example from '../../docs/targets.example.json';
import { parseTargets, TARGETS_VERSION } from './targets.ts';

const entry = { id: 't1', name: 'Test cap', period: 'week', metric: 'spending', target: 100, direction: 'max' };
const file = (targets: unknown[], extra: Record<string, unknown> = {}) => ({
  version: TARGETS_VERSION,
  targets,
  ...extra,
});

describe('parseTargets', () => {
  it('accepts the example file with no warnings', () => {
    const { targets, effective, warnings } = parseTargets(example);
    expect(warnings).toEqual([]);
    expect(targets).toHaveLength(example.targets.length);
    expect(effective).toEqual(example.effective);
  });

  it('keeps a valid entry, including stretch and by', () => {
    const full = { ...entry, period: 'year', direction: 'min', stretch: 150, by: '2027-06-30' };
    const { targets, warnings } = parseTargets(file([full]));
    expect(targets).toEqual([full]);
    expect(warnings).toEqual([]);
  });

  it('accepts a file with no targets', () => {
    expect(parseTargets(file([]))).toEqual({ targets: [], warnings: [] });
  });

  it.each([{ ...file([entry]), version: 2 }, { targets: [entry] }, null, 'text', [entry]])(
    'rejects a wrong version or shape wholesale with one warning: %j',
    (value) => {
      const { targets, warnings } = parseTargets(value);
      expect(targets).toEqual([]);
      expect(warnings).toHaveLength(1);
    },
  );

  it('rejects a non-array targets field', () => {
    const { targets, warnings } = parseTargets({ version: 1, targets: {} });
    expect(targets).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it.each([
    ['non-object entry', 'oops'],
    ['missing id', { ...entry, id: undefined }],
    ['empty id', { ...entry, id: '' }],
    ['missing name', { ...entry, name: undefined }],
    ['bad period', { ...entry, period: 'day' }],
    ['empty metric', { ...entry, metric: '' }],
    ['zero target', { ...entry, target: 0 }],
    ['negative target', { ...entry, target: -5 }],
    ['string target', { ...entry, target: '100' }],
    ['NaN-like target', { ...entry, target: null }],
    ['bad direction', { ...entry, direction: 'up' }],
    ['missing direction', { ...entry, direction: undefined }],
    ['string stretch', { ...entry, stretch: '80' }],
    ['negative stretch', { ...entry, stretch: -1 }],
    ['infinite stretch', { ...entry, stretch: Infinity }],
    ['max stretch above target', { ...entry, stretch: 150 }],
    ['min stretch below target', { ...entry, direction: 'min', stretch: 50 }],
    ['bad by date',{ ...entry, by: '2026-02-31' }],
    ['non-string by', { ...entry, by: 20260630 }],
  ])('drops an entry with a %s and warns once, keeping the rest', (_label, bad) => {
    const good = { ...entry, id: 'good' };
    const { targets, warnings } = parseTargets(file([bad, good]));
    expect(targets.map((t) => t.id)).toEqual(['good']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/entry 1\b/);
  });

  it('keeps the first of two entries sharing an id and warns', () => {
    const { targets, warnings } = parseTargets(file([entry, { ...entry, name: 'Second', target: 5 }]));
    expect(targets).toHaveLength(1);
    expect(targets[0]?.target).toBe(100);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/entry 2\b/);
  });

  it('accepts a stretch of zero, and one equal to target', () => {
    const { targets, warnings } = parseTargets(file([{ ...entry, stretch: 0 }, { ...entry, id: 't2', stretch: 100 }]));
    expect(targets).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('warnings never contain names or amounts, on every warning path', () => {
    const secret = (over: Record<string, unknown>) => ({ ...entry, name: 'Secret Name', target: 777, ...over });
    const inputs: unknown[] = [
      { ...file([secret({})]), version: 2 },
      { version: 1, targets: { name: 'Secret Name', amount: 777 } },
      file([secret({ id: undefined })]),
      file([secret({ name: undefined, metric: 'secret-metric-777' })]),
      file([secret({ period: 'day' })]),
      file([secret({ metric: '' })]),
      file([secret({ target: -777 })]),
      file([secret({ direction: 'up' })]),
      file([secret({ stretch: -888 })]),
      file([secret({ stretch: 999 })]),
      file([secret({ direction: 'min', stretch: 555 })]),
      file([secret({ by: '2026-02-31' })]),
      file([secret({}), secret({ name: 'Secret Second', target: 778 })]),
      file([secret({})], { effective: { from: '2031-01-01', to: '2030-01-01' } }),
      file([secret({})], { effective: 'Secret Name 777' }),
    ];
    for (const input of inputs) {
      const { warnings } = parseTargets(input);
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.join(' ')).not.toMatch(/Secret|777|778|888|999|555/);
    }
  });

  it('ignores a malformed effective range with a warning but keeps targets', () => {
    for (const effective of [{ from: '2026-11-01' }, { from: '2027-01-01', to: '2026-01-01' }, 'now']) {
      const { targets, effective: out, warnings } = parseTargets(file([entry], { effective }));
      expect(targets).toHaveLength(1);
      expect(out).toBeUndefined();
      expect(warnings).toHaveLength(1);
    }
  });
});
