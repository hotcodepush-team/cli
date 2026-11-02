import type { Release } from '@hotcodepush/node';
import { describe, expect, it, vi } from 'vitest';
import { resolveDiagnosticText } from '../../../test/diagnostics.js';
import { printCreatedRelease } from './output.js';

const RELEASE = {
  id: 'b7d1f2c0-4e71-4d6a-9f0e-2b6c1f5a8d93',
  liveAt: null,
  number: 43,
  progression: null,
  rolloutPercent: 10,
} as Release;

function captureOutput() {
  const consoleLog = vi
    .spyOn(console, 'log')
    .mockImplementation(() => undefined);
  const stderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  return {
    readDiagnostics: () =>
      resolveDiagnosticText(
        stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
      ),
    readLines: () => consoleLog.mock.calls.map(values => values.join(' ')),
  };
}

describe('printCreatedRelease', () => {
  it('should list the steps still ahead of the release and point at release get while it is not live', () => {
    const output = captureOutput();

    printCreatedRelease(
      {
        ...RELEASE,
        progression: {
          rolloutPercents: [10, 25, 50, 100],
          stepMinimumSeconds: 60,
          stepMinimumUpdateCount: 50,
        },
      } as Release,
      { bundleLabel: '#17 · 1.4.2', channelName: 'production' },
    );

    expect(output.readLines()).toEqual([
      'Created release #43 of production.',
      `ID       ${RELEASE.id}`,
      'Bundle   #17 · 1.4.2',
      'Rollout  10 percent, then 25, 50 and 100',
      'Live     not yet',
    ]);
    expect(output.readDiagnostics()).toBe(
      'Run "hotcodepush release get 43" to see when it is live.\n',
    );
  });

  it('should name the one step ahead without a list', () => {
    const output = captureOutput();

    printCreatedRelease(
      {
        ...RELEASE,
        liveAt: '2026-11-02T10:00:00.000Z',
        progression: {
          rolloutPercents: [10, 100],
          stepMinimumSeconds: 60,
          stepMinimumUpdateCount: 50,
        },
      } as Release,
      { bundleLabel: '#17 · 1.4.2', channelName: 'production' },
    );

    expect(output.readLines()).toContain('Rollout  10 percent, then 100');
    expect(output.readDiagnostics()).toBe('');
  });
});
