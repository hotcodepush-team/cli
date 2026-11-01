import type { Audience } from '@hotcodepush/node';
import { printWarning } from './diagnostics.js';

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
    printWarning(message);
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

// Decimal units, as the limits use.
export function resolveByteText(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1000).toFixed(1)} kB`;
  }
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export function resolveDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export function resolveQuantityText(
  count: number,
  { noun, pluralNoun = `${noun}s` }: { noun: string; pluralNoun?: string },
): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

export function resolveYesNoText(value: boolean | undefined): string {
  return value ? 'yes' : 'no';
}
