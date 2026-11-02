import { styleText } from 'node:util';
import { S_ERROR, S_INFO, S_SUCCESS, S_WARN } from '@clack/prompts';
import { isColorEnabled } from './environment.js';

interface ErrorDiagnostic {
  docsUrl: string;
  sentences: string[];
}

type SymbolColor = 'blue' | 'green' | 'red' | 'yellow';

// A diagnostic addresses the person, so it goes to stderr; stdout stays the command's result.
// It is one symbol and its lines, the symbols the prompts draw, without the gutter a lone line would leave open.
export function printError({ docsUrl, sentences }: ErrorDiagnostic): void {
  printDiagnostic([...sentences, styleStderr('dim', docsUrl)], {
    color: 'red',
    symbol: S_ERROR,
  });
}

export function printNotice(text: string): void {
  printDiagnostic(text.split('\n'), { color: 'blue', symbol: S_INFO });
}

export function printSuccess(text: string): void {
  printDiagnostic(text.split('\n'), { color: 'green', symbol: S_SUCCESS });
}

export function printWarning(text: string): void {
  printDiagnostic(text.split('\n'), { color: 'yellow', symbol: S_WARN });
}

// A blank line ends a block of diagnostics on a terminal, so the result after it starts on its own.
export function printBlockEnd(): void {
  if (process.stderr.isTTY) {
    process.stderr.write('\n');
  }
}

function printDiagnostic(
  [firstLine = '', ...continuationLines]: string[],
  { color, symbol }: { color: SymbolColor; symbol: string },
): void {
  const lines = [
    `${styleStderr(color, symbol)}  ${firstLine}`,
    ...continuationLines.map(line => `   ${line}`),
  ];
  process.stderr.write(`${lines.join('\n')}\n`);
}

function styleStderr(format: SymbolColor | 'dim', text: string): string {
  return isColorEnabled(process.stderr)
    ? styleText(format, text, { validateStream: false })
    : text;
}
