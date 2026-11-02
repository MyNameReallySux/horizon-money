/** A pay period as ISO dates `YYYY-MM-DD`, both ends inclusive. */
export interface PayPeriod {
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 31;
/** Characters a value may sit after its label (a colon, "Date", spacing) before it no longer belongs to it. */
const LABEL_REACH = 40;

const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})`;
const TABLE_LOOKAHEAD = 3;
const TABLE_LABEL = /check\s*date|pay\s*date|period\s*start(?:ing)?|period\s*begin(?:ning)?|period\s*end(?:ing)?/gi;
const SEPARATOR = String.raw`\s*(?:-|–|—|to|through|thru)\s*`;
const RANGE = new RegExp(String.raw`period[^0-9]{0,${LABEL_REACH}}?${DATE}${SEPARATOR}${DATE}`, 'i');
/** Bare `from`/`to` are too common to label a lone date, so they count only as an adjacent pair. */
const FROM_RANGE = new RegExp(String.raw`\bfrom\s+${DATE}${SEPARATOR}${DATE}`, 'i');
const PAY_PERIOD_PAIR = new RegExp(String.raw`pay period[^0-9]{0,${LABEL_REACH}}?${DATE}\s+${DATE}`, 'i');
const DATE_G = new RegExp(DATE, 'gi');
const LABELS: { kind: 'start' | 'end'; pattern: RegExp }[] = [
  { kind: 'start', pattern: /period\s*(?:begin(?:ning)?|start(?:ing)?)|(?:begin(?:ning)?|start(?:ing)?)\s*date/gi },
  { kind: 'end', pattern: /period\s*end(?:ing)?|end(?:ing)?\s*date/gi },
];

function toIso(raw: string): string | null {
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw);
    if (!us) return null;
    [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
    if (us[3]!.length === 2) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

function validPeriod(a: string | null, b: string | null): PayPeriod | null {
  if (a === null || b === null || a > b) return null;
  const span = (Date.parse(b) - Date.parse(a)) / DAY_MS + 1;
  return span > MAX_SPAN_DAYS ? null : { start: a, end: b };
}

/**
 * Header-then-values table: a line holding the date labels (`Check Date | Period Start | Period
 * End`, cells separated by `|` or spaces) followed by a line with their dates in the same order.
 * Up to {@link TABLE_LOOKAHEAD} non-empty lines after the header are searched, since the stub
 * puts a short row without dates between the header and its values; lines with no dates are skipped.
 * The i-th date belongs to the i-th label, so the labels' own order picks start and end. Returns
 * null, not undefined, when the header is found but its values cannot be mapped, so the looser
 * shapes do not guess from the same text.
 */
function tableRow(text: string): PayPeriod | null | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[|\t]/g, ' ').replace(/ +/g, ' ').trim());
  for (let i = 0; i < lines.length - 1; i++) {
    const labels = [...lines[i]!.matchAll(TABLE_LABEL)].map((m) => m[0].toLowerCase().replace(/\s+/g, ''));
    const startAt = labels.findIndex((l) => /^period(?:start|begin)/.test(l));
    const endAt = labels.findIndex((l) => /^periodend/.test(l));
    if (startAt < 0 || endAt < 0 || [...lines[i]!.matchAll(DATE_G)].length > 0) continue;
    const following = lines.slice(i + 1).filter((l) => l !== '').slice(0, TABLE_LOOKAHEAD);
    for (const row of following) {
      const dates = [...row.matchAll(DATE_G)].map((m) => toIso(m[1]!));
      if (dates.length === 0) continue;
      if (dates.length !== labels.length) return null;
      return validPeriod(dates[startAt]!, dates[endAt]!);
    }
  }
  return undefined;
}

/** Labelled start/end values, where a run of adjacent labels takes the dates after it in order (table headers). */
function labelledPair(text: string): PayPeriod | null {
  const hits = LABELS.flatMap(({ kind, pattern }) =>
    [...text.matchAll(pattern)].map((m) => ({ kind, from: m.index, to: m.index + m[0].length })),
  ).sort((a, b) => a.from - b.from);
  const dates = [...text.matchAll(DATE_G)].map((m) => ({ at: m.index, iso: toIso(m[1]!) }));

  let start: string | null = null;
  let end: string | null = null;
  for (let i = 0; i < hits.length; ) {
    let j = i + 1;
    while (j < hits.length && !dates.some((d) => d.at >= hits[j - 1]!.to && d.at < hits[j]!.from)) j++;
    const group = hits.slice(i, j);
    const after = dates.filter((d) => d.at >= group[group.length - 1]!.to);
    group.forEach((hit, k) => {
      const date = after[k];
      if (!date || date.at - group[group.length - 1]!.to > LABEL_REACH * (k + 1)) return;
      if (hit.kind === 'start') start ??= date.iso;
      else end ??= date.iso;
    });
    i = j;
  }
  return validPeriod(start, end);
}

/**
 * Finds the pay period in text extracted from a pay stub. Accepted shapes, any letter case:
 *
 * - a range after a "Pay Period" / "Period" label: `Pay Period: 01/01/2025 - 01/14/2025`
 *   (the separator may be `-`, an en or em dash, `to`, `through` or `thru`; only after "Pay Period" may it be
 *   just whitespace);
 * - labelled halves: `Period Beginning: 1/1/25  Period Ending: 1/14/25`, `Period Start` /
 *   `Period End`, `Begin Date` / `End Date`, `From 2025-01-01 To 2025-01-14`;
 * - a header row of such labels followed by their dates in the same order;
 * - a table whose header line holds `Check Date`, `Period Start` and `Period End` (cells split by
 *   `|`, tabs or spaces) and whose next line holds one date per label, in label order.
 *
 * Dates are `MM/DD/YYYY`, `MM-DD-YYYY`, `M/D/YY` (read as 20YY) or `YYYY-MM-DD`. Returns null when nothing
 * matches, a date is not a real calendar day, start is after end, or the span exceeds 31 days.
 */
export function parsePayPeriod(text: string): PayPeriod | null {
  const table = tableRow(text);
  if (table !== undefined) return table;
  const flat = text.replace(/\s+/g, ' ');
  const range = RANGE.exec(flat) ?? FROM_RANGE.exec(flat) ?? PAY_PERIOD_PAIR.exec(flat);
  if (range) {
    const found = validPeriod(toIso(range[1]!), toIso(range[2]!));
    if (found) return found;
  }
  return labelledPair(flat);
}
