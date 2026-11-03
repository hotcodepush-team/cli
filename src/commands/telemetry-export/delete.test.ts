import { S_SUCCESS } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, TELEMETRY_EXPORT } from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import { confirm } from '../../utils/prompt-renderers.js';
import telemetryExportDeleteCommand from './delete.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const TELEMETRY_EXPORT_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/telemetry-export`;

const CONSEQUENCE =
  'deletes the telemetry export: nothing more is sent to https://otlp.example.com and its headers are forgotten';

describe('telemetry-export delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithExport(): void {
    harness.routes[`GET ${TELEMETRY_EXPORT_PATH}`] = () =>
      Response.json(TELEMETRY_EXPORT);
    harness.routes[`DELETE ${TELEMETRY_EXPORT_PATH}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should delete the export once confirmed, naming the URL that receives nothing more', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithExport();

    await telemetryExportDeleteCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This ${CONSEQUENCE}. Continue?`,
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `${S_SUCCESS}  Deleted the telemetry export for https://otlp.example.com.`,
      `   ID  ${TELEMETRY_EXPORT.id}`,
      '',
    ]);
  });

  it('should delete nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithExport();

    await telemetryExportDeleteCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readDeleteRequests()).toEqual([]);
  });

  it('should delete without asking and print the id and URL of what went when --yes and --json are passed', async () => {
    respondWithExport();

    await telemetryExportDeleteCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual({
      id: TELEMETRY_EXPORT.id,
      name: 'https://otlp.example.com',
    });
  });

  it('should throw `confirmation_required` with the consequence and delete nothing when nobody can be asked', async () => {
    respondWithExport();

    await expect(
      telemetryExportDeleteCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new ConfirmationRequiredError(CONSEQUENCE));
    expect(readDeleteRequests()).toEqual([]);
  });
});
