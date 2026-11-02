import { styleText } from 'node:util';
import { S_SUCCESS } from '@clack/prompts';
import type { Audience } from '@hotcodepush/node';
import { printWarning } from './diagnostics.js';
import { isColorEnabled } from './environment.js';

export type Detail = [label: string, value: string];

interface Result {
  rows: Detail[];
  sentence: string;
}

interface Table {
  emptyText: string;
  headers: string[];
  nextOffset: number | null;
  rows: string[][];
}

type Warning = Audience['warnings'][number];

export function printDetails(details: Detail[]): void {
  for (const line of resolveDetailLines(details)) {
    console.log(line);
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

// Decorated where a person reads it, plain where a program does.
export function printResult({ rows, sentence }: Result): void {
  if (!process.stdout.isTTY) {
    console.log(sentence);
    printDetails(rows);
    return;
  }
  const symbol = isColorEnabled(process.stdout)
    ? styleText('green', S_SUCCESS, { validateStream: false })
    : S_SUCCESS;
  console.log(`${symbol}  ${sentence}`);
  for (const line of resolveDetailLines(rows)) {
    console.log(`   ${line}`);
  }
  console.log('');
}

// Between two results: a terminal already has the first result's blank line, a pipe gets one here.
export function printResultGap(): void {
  if (!process.stdout.isTTY) {
    console.log('');
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

function resolveDetailLines(details: Detail[]): string[] {
  const labelWidth = Math.max(...details.map(([label]) => label.length));
  return details.map(
    ([label, value]) => `${label.padEnd(labelWidth)}  ${value}`,
  );
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
