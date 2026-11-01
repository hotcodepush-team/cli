import { stripVTControlCharacters } from 'node:util';

// Removes the gutter clack draws around a diagnostic: the lines holding only a bar and the symbol before each line's text.
export function resolveDiagnosticText(stderr: string): string {
  return stripVTControlCharacters(stderr)
    .split('\n')
    .filter(line => !/^\S+$/.test(line))
    .map(line => line.replace(/^\S+ {2}/, ''))
    .join('\n');
}
