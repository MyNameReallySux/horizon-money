import type { GoalPeriod } from './contract.ts';
import { isIsoDate } from './manual.ts';

/** Version of the `targets.json` format; `parseTargets` rejects other versions wholesale. */
export const TARGETS_VERSION = 1;

const PERIODS: readonly GoalPeriod[] = ['week', 'month', 'year'];

/**
 * One target from the plan. `metric` is a free-form key the UI interprets; the known keys are:
 * - `spending`: total spend in the period
 * - `category:<name>` / `group:<name>`: spend cap for one category or category group
 * - `debt-paydown`: dollars paid toward debts
 * - `card-balance`: maximum total credit card balance
 * - `interest`: maximum monthly interest
 * - `emergency-fund`: savings target
 * - `paychecks-missed`: maximum count of missed paychecks
 */
export interface Target {
  /** Unique within the file. */
  id: string;
  name: string;
  period: GoalPeriod;
  metric: string;
  /** Positive, in the metric's unit (dollars, or a count). */
  target: number;
  /** `max` is a cap to stay under, `min` a floor to reach. */
  direction: 'max' | 'min';
  /** A more ambitious value than `target`. */
  stretch?: number;
  /** ISO date `YYYY-MM-DD` a yearly goal is due. */
  by?: string;
}

/** The contents of `<dataDir>/targets.json`. */
export interface TargetsFile {
  version: typeof TARGETS_VERSION;
  /** Range of dates the plan applies to. */
  effective?: { from: string; to: string };
  targets: Target[];
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const isNonEmptyString = (x: unknown): x is string => typeof x === 'string' && x !== '';

/** Names the first problem with an entry, or null when it is valid. Never echoes values. */
function invalidField(x: unknown): string | null {
  if (!isRecord(x)) return 'is not an object';
  if (!isNonEmptyString(x.id)) return 'has no id';
  if (!isNonEmptyString(x.name)) return 'has no name';
  if (!PERIODS.includes(x.period as GoalPeriod)) return 'has an invalid period';
  if (!isNonEmptyString(x.metric)) return 'has no metric';
  if (!isFiniteNumber(x.target) || x.target <= 0) return 'has a non-positive target';
  if (x.direction !== 'max' && x.direction !== 'min') return 'has an invalid direction';
  if (x.stretch !== undefined && !isFiniteNumber(x.stretch)) return 'has an invalid stretch';
  if (x.by !== undefined && !isIsoDate(x.by)) return 'has an invalid by date';
  return null;
}

/**
 * Validates a parsed `targets.json`. Invalid entries are dropped with one warning each and a
 * later entry repeating an earlier id is dropped (first wins); a wrong version or shape yields
 * no targets. Warnings name the entry by position and never contain names or amounts.
 * `effective` is returned only when well formed.
 */
export function parseTargets(x: unknown): {
  targets: Target[];
  effective?: { from: string; to: string };
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!isRecord(x) || x.version !== TARGETS_VERSION) {
    warnings.push(`targets.json: unsupported version or shape (expected version ${TARGETS_VERSION}); ignored`);
    return { targets: [], warnings };
  }
  if (!Array.isArray(x.targets)) {
    warnings.push('targets.json: "targets" is not an array; ignored');
    return { targets: [], warnings };
  }

  let effective: { from: string; to: string } | undefined;
  if (x.effective !== undefined) {
    const e = x.effective;
    if (isRecord(e) && isIsoDate(e.from) && isIsoDate(e.to) && e.from <= e.to) {
      effective = { from: e.from, to: e.to };
    } else {
      warnings.push('targets.json: "effective" is not a valid { from, to } date range; ignored');
    }
  }

  const targets: Target[] = [];
  const seen = new Set<string>();
  x.targets.forEach((entry: unknown, i: number) => {
    const problem = invalidField(entry);
    if (problem) {
      warnings.push(`targets.json: entry ${i + 1} ${problem}; dropped`);
      return;
    }
    const t = entry as Target;
    if (seen.has(t.id)) {
      warnings.push(`targets.json: entry ${i + 1} repeats an earlier id; dropped`);
      return;
    }
    seen.add(t.id);
    const out: Target = {
      id: t.id,
      name: t.name,
      period: t.period,
      metric: t.metric,
      target: t.target,
      direction: t.direction,
    };
    if (t.stretch !== undefined) out.stretch = t.stretch;
    if (t.by !== undefined) out.by = t.by;
    targets.push(out);
  });

  const result: { targets: Target[]; effective?: { from: string; to: string }; warnings: string[] } = {
    targets,
    warnings,
  };
  if (effective) result.effective = effective;
  return result;
}
