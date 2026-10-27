export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export interface Column<T> {
  header: string;
  get: (row: T) => unknown;
  /** Truncate longer cells with an ellipsis. */
  max?: number;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '-';
  return (typeof value === 'object' ? JSON.stringify(value) : String(value)).replace(/\s+/g, ' ');
}

function truncate(text: string, max: number | undefined): string {
  const chars = [...text];
  return max && chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
}

const width = (text: string) => [...text].length;

// Plain-text table on stdout; footers belong on stderr so pipes stay clean.
export function printTable<T>(rows: T[], columns: Column<T>[]): void {
  const cells = rows.map((row) => columns.map((c) => truncate(cell(c.get(row)), c.max)));
  const widths = columns.map((c, i) => Math.max(width(c.header), ...cells.map((r) => width(r[i]!))));
  const line = (values: string[]) => values.map((v, i) => v + ' '.repeat(widths[i]! - width(v))).join('  ').trimEnd();
  console.log(line(columns.map((c) => c.header)));
  for (const row of cells) console.log(line(row));
}

// "key: value" lines with the keys aligned.
export function printFields(fields: [string, unknown][]): void {
  const shown = fields.filter(([, v]) => v !== undefined && v !== null && v !== '');
  const pad = Math.max(0, ...shown.map(([k]) => k.length));
  for (const [key, value] of shown) console.log(`${(key + ':').padEnd(pad + 2)}${cell(value)}`);
}

// 2026-10-27T07:25:32.123456Z -> 2026-10-27 07:25
export function shortDate(iso: unknown): string {
  return typeof iso === 'string' ? iso.replace('T', ' ').slice(0, 16) : '-';
}

/** "N shown" plus a hint for the next page, on stderr. */
export function pageFooter(count: number, noun: string, next: string | undefined): void {
  console.error(`\n${count} ${noun}${next ? ` shown; more available: --cursor ${next}  (or --all)` : ''}`);
}
