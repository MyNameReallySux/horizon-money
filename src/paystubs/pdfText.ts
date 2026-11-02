/** The parts of a pdfjs text item that line reconstruction needs. */
export interface TextItem {
  str: string;
  /** pdfjs transform matrix: `[4]` is x and `[5]` is y, `[0]` roughly the font size. */
  transform: number[];
  width?: number;
}

/** Separator between cells of one reconstructed line. */
export const CELL_SEPARATOR = ' | ';

/**
 * Rebuilds readable lines from pdfjs text items. Items are grouped into rows by rounded y (top row
 * first) and ordered by x. A pay stub header can arrive one character per item, so runs of
 * single-character items collapse into one word; a whitespace item, or a horizontal gap wider
 * than a fifth of the font size when widths are known, ends the word. Words and multi-character
 * items are joined with {@link CELL_SEPARATOR}.
 */
export function linesFromTextItems(items: TextItem[]): string[] {
  const rows = new Map<number, TextItem[]>();
  for (const item of items) {
    const y = Math.round(item.transform[5] ?? 0);
    rows.set(y, [...(rows.get(y) ?? []), item]);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => {
      const cells: string[] = [];
      let word = '';
      let prevEnd: number | undefined;
      const flush = () => {
        if (word !== '') cells.push(word);
        word = '';
      };
      for (const item of [...row].sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0))) {
        const x = item.transform[4] ?? 0;
        const size = Math.abs(item.transform[0] ?? 0);
        if (item.str.trim() === '') {
          flush();
        } else if (item.str.length === 1) {
          if (prevEnd !== undefined && x - prevEnd > size * 0.2) flush();
          word += item.str;
        } else {
          flush();
          cells.push(item.str.trim());
        }
        prevEnd = item.width === undefined ? undefined : x + item.width;
      }
      flush();
      return cells.join(CELL_SEPARATOR);
    })
    .filter((line) => line !== '');
}
