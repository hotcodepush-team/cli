import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, TELEMETRY_EXPORT } from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import { MissingParameterError } from '../../utils/errors.js';
import { select, text } from '../../utils/prompt-renderers.js';
import telemetryExportSetCommand from './set.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const TELEMETRY_EXPORT_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/telemetry-export`;

describe('telemetry-export set', () => {
  const harness = useCommandHarness();

  async function readPutBody(): Promise<unknown> {
    return harness.requests.find(({ method }) => method === 'PUT')?.json();
  }

  function respondWithExport(): void {
    harness.routes[`PUT ${TELEMETRY_EXPORT_PATH}`] = () =>
      Response.json(TELEMETRY_EXPORT);
  }

  it('should send the headers as a map and the signals as a list from the flags and print the export', async () => {
    respondWithExport();

    await runCli(
      { 'telemetry-export set': () => import('./set.js') },
      {
        argv: [
          'telemetry-export',
          'set',
          '--organization',
          ACME_ORGANIZATION.id,
          '--url',
          'https://otlp.example.com',
          '--header',
          'Authorization=Bearer dG9rZW4=',
          '--header',
          'x-tenant=acme',
          '--signal',
          'logs, metrics',
        ],
        meta: PACKAGE_JSON,
      },
    );

    expect(await readPutBody()).toEqual({
      headers: { 'Authorization': 'Bearer dG9rZW4=', 'x-tenant': 'acme' },
      signals: ['logs', 'metrics'],
      url: 'https://otlp.example.com',
    });
    expect(harness.readLines()).toEqual([
      'Set the telemetry export for https://otlp.example.com.',
      `ID           ${TELEMETRY_EXPORT.id}`,
      'URL          https://otlp.example.com',
      'Signals      logs, metrics',
      'Headers      Authorization',
      'Disabled at  none',
      'Failures     0',
    ]);
  });

  it('should ask for the URL and the signals when they are missing and someone can be asked', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('https://otlp.example.com');
    vi.mocked(select).mockResolvedValue('metrics');
    respondWithExport();

    await telemetryExportSetCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(await readPutBody()).toEqual({
      headers: {},
      signals: ['metrics'],
      url: 'https://otlp.example.com',
    });
  });

  it('should throw `missing_parameter` naming --url when none is given and nobody can be asked', async () => {
    await expect(
      telemetryExportSetCommand.action(
        { organization: ACME_ORGANIZATION.id, signal: ['logs'] },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--url'));
  });

  it('should fail with `invalid_parameter` before any request when a header has no =', async () => {
    await expect(
      telemetryExportSetCommand.action(
        {
          header: ['Authorization'],
          organization: ACME_ORGANIZATION.id,
          signal: ['logs'],
          url: 'https://otlp.example.com',
        },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'invalid_parameter' });
    expect(harness.requests).toEqual([]);
  });
});
