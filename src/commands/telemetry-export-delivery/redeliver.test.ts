import { S_SUCCESS } from '@clack/prompts';
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
import {
  ConfirmationRequiredError,
  MissingParameterError,
} from '../../utils/errors.js';
import { confirm } from '../../utils/prompt-renderers.js';
import telemetryExportDeliveryRedeliverCommand from './redeliver.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const TELEMETRY_EXPORT_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/telemetry-export`;

const REDELIVER_PATH = `${TELEMETRY_EXPORT_PATH}/deliveries/${FAILED_TELEMETRY_EXPORT_DELIVERY.id}/redeliver`;

const CONSEQUENCE = `sends delivery ${FAILED_TELEMETRY_EXPORT_DELIVERY.id} to https://otlp.example.com again`;

const OPTIONS = {
  delivery: FAILED_TELEMETRY_EXPORT_DELIVERY.id,
  organization: ACME_ORGANIZATION.id,
};

const REDELIVERED_DELIVERY = {
  ...FAILED_TELEMETRY_EXPORT_DELIVERY,
  attemptCount: 4,
  responseBody: '',
  responseCode: 200,
  status: 'succeeded',
};

describe('telemetry-export-delivery redeliver', () => {
  const harness = useCommandHarness();

  function readRedeliverRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'POST');
  }

  function respondWithExport(): void {
    harness.routes[`GET ${TELEMETRY_EXPORT_PATH}`] = () =>
      Response.json(TELEMETRY_EXPORT);
    harness.routes[`POST ${REDELIVER_PATH}`] = () =>
      Response.json(REDELIVERED_DELIVERY, { status: 201 });
  }

  it("should send the delivery again once confirmed and print the backend's answer", async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithExport();

    await telemetryExportDeliveryRedeliverCommand.action(OPTIONS, undefined);

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This ${CONSEQUENCE}. Continue?`,
    });
    expect(readRedeliverRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `${S_SUCCESS}  Sent release.created to the telemetry export.`,
      `   ID        ${REDELIVERED_DELIVERY.id}`,
      '   Status    succeeded',
      '   Response  HTTP 200',
      '',
    ]);
  });

  it('should redeliver without asking and print the delivery as served when --yes and --json are passed', async () => {
    respondWithExport();

    await telemetryExportDeliveryRedeliverCommand.action(
      { ...OPTIONS, json: true, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual(REDELIVERED_DELIVERY);
  });

  it('should throw `confirmation_required` with the consequence and send nothing when nobody can be asked', async () => {
    respondWithExport();

    await expect(
      telemetryExportDeliveryRedeliverCommand.action(OPTIONS, undefined),
    ).rejects.toThrow(new ConfirmationRequiredError(CONSEQUENCE));
    expect(readRedeliverRequests()).toEqual([]);
  });

  it('should throw `missing_parameter` naming --delivery when none is given and nobody can be asked', async () => {
    respondWithExport();

    await expect(
      telemetryExportDeliveryRedeliverCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--delivery'));
  });
});
