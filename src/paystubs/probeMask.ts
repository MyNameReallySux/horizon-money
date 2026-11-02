const LABEL_WORDS = new Set([
  'pay', 'period', 'beginning', 'begin', 'start', 'starting', 'ending', 'end', 'from', 'to',
  'through', 'thru', 'date', 'check', 'of', 'the', 'for', 'week', 'weekly', 'biweekly',
  'employee', 'id', 'name', 'no',
]);

/** Letters the PDF emitted one per item can still arrive spaced out; rejoin them before masking. */
const collapseSplitLetters = (line: string): string =>
  line.replace(/(?<![A-Za-z])[A-Za-z](?: [A-Za-z](?![A-Za-z]))+/g, (run) => run.replace(/ /g, ''));

/**
 * Masks a pay stub line for the `--probe` output: every Unicode digit becomes `#` and every word
 * outside the label vocabulary collapses to a single `x`, so neither values nor name lengths leak.
 */
export const maskProbeLine = (line: string): string =>
  collapseSplitLetters(line)
    .replace(/\p{Nd}/gu, '#')
    .replace(/\p{L}+/gu, (w) => (LABEL_WORDS.has(w.toLowerCase()) ? w : 'x'));
