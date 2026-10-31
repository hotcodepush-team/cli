import { readFileSync } from 'node:fs';
import { InvalidJsonError } from './errors.js';

// V8 quotes the text around an unexpected token, which in config.json can be the auth token.
// Matches that message so only the unexpected token is kept.
const QUOTED_TEXT_PATTERN = /^(Unexpected token '.+?'), .*$/s;

export function readJsonFile(filePath: string): unknown {
  return parseJsonFileText(filePath, readFileSync(filePath, 'utf8'));
}

export function parseJsonFileText(filePath: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    throw new InvalidJsonError(filePath, resolveJsonSyntaxProblem(error));
  }
}

// Keeps the indentation and final newline of the file, so the diff is only the edited line.
export function stringifyLikeSource(
  value: unknown,
  sourceText: string,
): string {
  const indent = /^(\s+)"/m.exec(sourceText)?.[1] ?? '  ';
  const newline = sourceText.endsWith('\n') ? '\n' : '';
  return `${JSON.stringify(value, null, indent)}${newline}`;
}

function resolveJsonSyntaxProblem({ message }: SyntaxError): string {
  return message.replace(QUOTED_TEXT_PATTERN, '$1');
}
