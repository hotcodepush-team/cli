import type { Audience } from '@hotcodepush/node';

interface Table {
  emptyText: string;
  headers: string[];
  nextOffset: number | null;
  rows: string[][];
}

/**
 * A warning in the API's shape; every resource that answers one shares it.
 */
type Warning = Audience['warnings'][number];

/**
 * One resource as label and value per line, the labels aligned.
 */
export function printDetails(details: [label: string, value: string][]): void {
  const labelWidth = Math.max(...details.map(([label]) => label.length));
  for (const [label, value] of details) {
    console.log(`${label.padEnd(labelWidth)}  ${value}`);
  }
}

/**
 * The one document `--json` puts on stdout, indented for a person reading along.
 */
export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/**
 * What the API answered beside a row it created or a preview it computed, likely not what was meant: one line each on stderr,
 * its message as received.
 */
export function printWarnings(warnings: Warning[]): void {
  for (const { message } of warnings) {
    process.stderr.write(`Warning: ${message}\n`);
  }
}

/**
 * A page of a list as aligned columns, ending with the offset of the next page when there is one.
 */
export function printTable({
  emptyText,
  headers,
  nextOffset,
  rows,
}: Table): void {
  if (rows.length === 0) {
    console.log(emptyText);
    return;
  }
  const columnWidths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map(row => row[columnIndex]?.length ?? 0)),
  );
  for (const cells of [headers, ...rows]) {
    console.log(
      cells
        .map((cell, columnIndex) => cell.padEnd(columnWidths[columnIndex] ?? 0))
        .join('  ')
        .trimEnd(),
    );
  }
  if (nextOffset !== null) {
    console.log(`Next page: --offset ${nextOffset}`);
  }
}

/**
 * The day of an ISO 8601 timestamp, 2026-09-29, for a table's narrow column.
 */
export function resolveDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * A count with its noun, 1 app or 3 apps.
 */
export function resolveQuantityText(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
