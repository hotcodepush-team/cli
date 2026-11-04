import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  FAILED_TELEMETRY_EXPORT_DELIVERY,
  TELEMETRY_EXPORT,
} from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import { confirm } from '../../utils/prompt-renderers.js';
import telemetryExportTestCommand from './test.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const TELEMETRY_EXPORT_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/telemetry-export`;

const CONSEQUENCE =
  'sends one record per enabled signal to https://otlp.example.com';

const TEST_DELIVERIES = [
  {
    ...FAILED_TELEMETRY_EXPORT_DELIVERY,
    attemptCount: 1,
    auditRowId: null,
    responseBody: '',
    responseCode: 200,
    status: 'succeeded',
    type: 'telemetry_export.test',
  },
  {
    ...FAILED_TELEMETRY_EXPORT_DELIVERY,
    attemptCount: 1,
    auditRowId: null,
    type: 'metrics',
  },
];

describe('telemetry-export test', () => {
  const harness = useCommandHarness();

  function readTestRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'POST');
  }

  function respondWithExport(): void {
    harness.routes[`GET ${TELEMETRY_EXPORT_PATH}`] = () =>
      Response.json(TELEMETRY_EXPORT);
    harness.routes[`POST ${TELEMETRY_EXPORT_PATH}/test`] = () =>
      Response.json(TEST_DELIVERIES, { status: 201 });
  }

  it("should send the records once confirmed and print each delivery with the backend's answer, a blank line between", async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithExport();

    await telemetryExportTestCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This ${CONSEQUENCE}. Continue?`,
    });
    expect(harness.readLines()).toEqual([
      expect.stringContaining(
        'Sent telemetry_export.test to the telemetry export.',
      ),
      `   ID        ${FAILED_TELEMETRY_EXPORT_DELIVERY.id}`,
      '   Status    succeeded',
      '   Response  HTTP 200',
      '',
      expect.stringContaining('Sent metrics to the telemetry export.'),
      `   ID        ${FAILED_TELEMETRY_EXPORT_DELIVERY.id}`,
      '   Status    failed',
      '   Response  HTTP 503',
      '',
    ]);
  });

  it('should send nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithExport();

    await telemetryExportTestCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readTestRequests()).toEqual([]);
  });

  it('should send without asking and print the deliveries as served when --yes and --json are passed', async () => {
    respondWithExport();

    await telemetryExportTestCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual(TEST_DELIVERIES);
  });

  it('should throw `confirmation_required` with the consequence and send nothing when nobody can be asked', async () => {
    respondWithExport();

    await expect(
      telemetryExportTestCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new ConfirmationRequiredError(CONSEQUENCE));
    expect(readTestRequests()).toEqual([]);
  });
});
