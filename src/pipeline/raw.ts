/** Collects non-fatal findings while mapping; messages carry counts only, never names or amounts. */
export type Warn = (message: string) => void;

export const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * The Monarch MCP wraps each payload as `{"result": "<JSON string>"}`. Returns the inner payload
 * for that shape and the input unchanged for an already-unwrapped one.
 */
export function unwrapMcp(parsed: unknown): unknown {
  if (isRecord(parsed) && typeof parsed.result === 'string' && Object.keys(parsed).length === 1) {
    return JSON.parse(parsed.result) as unknown;
  }
  return parsed;
}

/** Reads `raw[key]` as an array of records, throwing with the file name when it is not one. */
export function recordsAt(raw: unknown, path: string[], file: string): Record<string, unknown>[] {
  let node: unknown = raw;
  for (const key of path) {
    if (!isRecord(node)) throw new Error(`${file}: expected an object at "${path.join('.')}"`);
    node = node[key];
  }
  if (!Array.isArray(node)) throw new Error(`${file}: expected an array at "${path.join('.')}"`);
  return node.filter(isRecord);
}

/** Rounds to cents so floating-point sums do not leak noise into the snapshot. */
export const cents = (n: number): number => Math.round(n * 100) / 100;
