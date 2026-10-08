import { readFileSync } from 'node:fs';
import { InvalidJsonError } from './errors.js';

// V8 quotes the text around an unexpected token, which in config.json can be the token; only the token itself is kept
const QUOTED_TEXT_PATTERN = /^(Unexpected token '.+?'), .*$/s;

/**
 * A JSON file a person edits — `hotcodepush.json`, `package.json`, `config.json` — parsed; one that does not parse is
 * `E_INVALID_JSON`, naming the file and where its parse stopped.
 */
export function readJsonFile(filePath: string): unknown {
  return parseJsonFileText(filePath, readFileSync(filePath, 'utf8'));
}

/**
 * The text of such a file, read already to keep its indentation for a write back, parsed as `readJsonFile` parses it.
 */
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

/**
 * The JSON written back with the indentation and the final newline the file had, so the edit is the one line it means.
 */
export function stringifyLikeSource(
  value: unknown,
  sourceText: string,
): string {
  const indent = /^(\s+)"/m.exec(sourceText)?.[1] ?? '  ';
  const newline = sourceText.endsWith('\n') ? '\n' : '';
  return `${JSON.stringify(value, null, indent)}${newline}`;
}

/**
 * Where the parse stopped, in V8's words with its first letter lowercase and without the file's text.
 */
function resolveJsonSyntaxProblem({ message }: SyntaxError): string {
  const problem = message.replace(QUOTED_TEXT_PATTERN, '$1');
  return `${problem.charAt(0).toLowerCase()}${problem.slice(1)}`;
}
