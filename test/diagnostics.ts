import { stripVTControlCharacters } from 'node:util';

// Removes what a diagnostic draws around its text: the symbol before its first line, the indent under it and the gutter of a prompt.
export function resolveDiagnosticText(stderr: string): string {
  return stripVTControlCharacters(stderr)
    .split('\n')
    .filter(line => !/^\S+$/.test(line))
    .map(line => line.replace(/^\S+ {2}/, '').replace(/^ {3}/, ''))
    .join('\n');
}
