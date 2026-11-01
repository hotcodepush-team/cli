import { styleText } from 'node:util';
import { log } from '@clack/prompts';
import { isColorEnabled } from './environment.js';

interface ErrorDiagnostic {
  docsUrl: string;
  sentences: string[];
}

// A diagnostic addresses the person, so it goes to stderr in the gutter the prompts use; stdout stays the command's result.
const STDERR = { output: process.stderr };

export function printError({ docsUrl, sentences }: ErrorDiagnostic): void {
  const styledDocsUrl = isColorEnabled(process.stderr)
    ? styleText('dim', docsUrl, { validateStream: false })
    : docsUrl;
  log.error([...sentences, styledDocsUrl].join('\n'), STDERR);
}

export function printNotice(text: string): void {
  log.info(text, STDERR);
}

export function printSuccess(text: string): void {
  log.success(text, STDERR);
}

export function printWarning(text: string): void {
  log.warn(text, STDERR);
}
