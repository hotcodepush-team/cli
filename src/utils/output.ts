import type { Audience } from '@hotcodepush/node';

interface Table {
  emptyText: string;
  headers: string[];
  nextOffset: number | null;
  rows: string[][];
}

type Warning = Audience['warnings'][number];

export function printDetails(details: [label: string, value: string][]): void {
  const labelWidth = Math.max(...details.map(([label]) => label.length));
  for (const [label, value] of details) {
    console.log(`${label.padEnd(labelWidth)}  ${value}`);
  }
}

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

// The API warns when a computed preview is likely not what was meant.
export function printWarnings(warnings: Warning[]): void {
  for (const { message } of warnings) {
    process.stderr.write(`Warning: ${message}\n`);
  }
}

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

export function resolveDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export function resolveQuantityText(
  count: number,
  noun: string,
  pluralNoun = `${noun}s`,
): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}
