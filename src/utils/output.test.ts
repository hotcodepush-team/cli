import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  printDetails,
  printResult,
  printTable,
  resolveQuantityText,
} from './output.js';

const originalStdoutIsTty = process.stdout.isTTY;

function captureLines() {
  const consoleLog = vi
    .spyOn(console, 'log')
    .mockImplementation(() => undefined);
  return () => consoleLog.mock.calls.map(values => values.join(' '));
}

describe('output', () => {
  it('should print a table in aligned columns ending with the next offset', () => {
    const readLines = captureLines();

    printTable({
      emptyText: 'No channels.',
      headers: ['NAME', 'STATE'],
      nextOffset: 50,
      rows: [
        ['production', 'running'],
        ['beta', 'paused'],
      ],
    });

    expect(readLines()).toEqual([
      'NAME        STATE',
      'production  running',
      'beta        paused',
      'Next page: --offset 50',
    ]);
  });

  it('should print the empty text instead of a table without rows', () => {
    const readLines = captureLines();

    printTable({
      emptyText: 'No channels.',
      headers: ['NAME'],
      nextOffset: null,
      rows: [],
    });

    expect(readLines()).toEqual(['No channels.']);
  });

  afterEach(() => {
    process.stdout.isTTY = originalStdoutIsTty;
  });

  it('should print a result as plain lines when stdout is no terminal', () => {
    process.stdout.isTTY = false;
    const readLines = captureLines();

    printResult({
      rows: [
        ['ID', '1'],
        ['Private key', '/tmp/key.pem'],
      ],
      sentence: 'Created a signing key.',
    });

    expect(readLines()).toEqual([
      'Created a signing key.',
      'ID           1',
      'Private key  /tmp/key.pem',
    ]);
  });

  it('should print a result behind the success symbol, its rows indented and a blank line after, when stdout is a terminal without colour', () => {
    process.stdout.isTTY = true;
    vi.stubEnv('NO_COLOR', '1');
    const readLines = captureLines();

    printResult({ rows: [['ID', '1']], sentence: 'Created a signing key.' });

    expect(readLines()).toEqual([
      expect.stringMatching(/^\S+ {2}Created a signing key\.$/),
      '   ID  1',
      '',
    ]);
    expect(readLines().join('\n')).not.toContain('\x1b[');
  });

  it('should print details with the labels aligned', () => {
    const readLines = captureLines();

    printDetails([
      ['ID', '1'],
      ['Created', '2026-09-29'],
    ]);

    expect(readLines()).toEqual(['ID       1', 'Created  2026-09-29']);
  });

  it.each([
    [1, '1 app'],
    [3, '3 apps'],
  ])('should phrase %i with its noun as %s', (count, text) => {
    expect(resolveQuantityText(count, { noun: 'app' })).toBe(text);
  });

  it('should phrase a count with the plural noun given', () => {
    expect(
      resolveQuantityText(2, { noun: 'patch', pluralNoun: 'patches' }),
    ).toBe('2 patches');
  });
});
