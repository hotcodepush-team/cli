import { describe, expect, it, vi } from 'vitest';
import { printDetails, printTable, resolveQuantityText } from './output.js';

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
    expect(resolveQuantityText(count, 'app')).toBe(text);
  });

  it('should phrase a count with the plural noun given', () => {
    expect(resolveQuantityText(2, 'patch', 'patches')).toBe('2 patches');
  });
});
