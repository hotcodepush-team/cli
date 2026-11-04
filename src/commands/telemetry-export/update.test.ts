import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, TELEMETRY_EXPORT } from '../../../test/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import { select } from '../../utils/prompt-renderers.js';
import telemetryExportUpdateCommand from './update.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const TELEMETRY_EXPORT_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/telemetry-export`;

describe('telemetry-export update', () => {
  const harness = useCommandHarness();

  async function readPatchBody(): Promise<unknown> {
    return harness.requests.find(({ method }) => method === 'PATCH')?.json();
  }

  function respondWithExport(): void {
    harness.routes[`PATCH ${TELEMETRY_EXPORT_PATH}`] = () =>
      Response.json(TELEMETRY_EXPORT);
  }

  it('should turn the export off and say so', async () => {
    respondWithExport();

    await telemetryExportUpdateCommand.action(
      { enabled: false, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(await readPatchBody()).toEqual({ isEnabled: false });
    expect(harness.readLines()).toEqual([
      'Disabled the telemetry export for https://otlp.example.com.',
      `ID  ${TELEMETRY_EXPORT.id}`,
    ]);
  });

  it('should ask whether the export delivers when --enabled is missing and someone can be asked', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue('on');
    respondWithExport();

    await telemetryExportUpdateCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(await readPatchBody()).toEqual({ isEnabled: true });
  });

  it('should throw `missing_parameter` naming --enabled and send nothing when nobody can be asked', async () => {
    await expect(
      telemetryExportUpdateCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--enabled'));
    expect(await readPatchBody()).toBeUndefined();
  });
});
