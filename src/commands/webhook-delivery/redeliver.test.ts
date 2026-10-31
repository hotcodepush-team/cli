import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  FAILED_WEBHOOK_DELIVERY,
  WEBHOOK,
} from '../../../test/fixtures.js';
import {
  ConfirmationRequiredError,
  MissingParameterError,
} from '../../utils/errors.js';
import webhookDeliveryRedeliverCommand from './redeliver.js';

vi.mock('@clack/prompts');

const WEBHOOK_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks/${WEBHOOK.id}`;

const REDELIVER_PATH = `${WEBHOOK_PATH}/deliveries/${FAILED_WEBHOOK_DELIVERY.id}/redeliver`;

const CONSEQUENCE = `sends the event of delivery ${FAILED_WEBHOOK_DELIVERY.id} to ${WEBHOOK.url} again`;

const OPTIONS = {
  delivery: FAILED_WEBHOOK_DELIVERY.id,
  organization: ACME_ORGANIZATION.id,
  webhook: WEBHOOK.id,
};

const REDELIVERED_DELIVERY = {
  ...FAILED_WEBHOOK_DELIVERY,
  attemptCount: 4,
  responseBody: 'ok',
  responseCode: 200,
  status: 'succeeded',
};

describe('webhook-delivery redeliver', () => {
  const harness = useCommandHarness();

  function readRedeliverRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'POST');
  }

  function respondWithWebhook(): void {
    harness.routes[`GET ${WEBHOOK_PATH}`] = () => Response.json(WEBHOOK);
    harness.routes[`POST ${REDELIVER_PATH}`] = () =>
      Response.json(REDELIVERED_DELIVERY, { status: 201 });
  }

  it("should deliver the event again once confirmed and print the receiver's answer", async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithWebhook();

    await webhookDeliveryRedeliverCommand.action(OPTIONS, undefined);

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This ${CONSEQUENCE}. Continue?`,
    });
    expect(readRedeliverRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      'Sent release.created to webhook releases: succeeded, HTTP 200.',
    ]);
  });

  it('should redeliver without asking and print the delivery as served when --yes and --json are passed', async () => {
    respondWithWebhook();

    await webhookDeliveryRedeliverCommand.action(
      { ...OPTIONS, json: true, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual(REDELIVERED_DELIVERY);
  });

  it('should throw `confirmation_required` with the consequence and send nothing when nobody can be asked', async () => {
    respondWithWebhook();

    await expect(
      webhookDeliveryRedeliverCommand.action(OPTIONS, undefined),
    ).rejects.toThrow(new ConfirmationRequiredError(CONSEQUENCE));
    expect(readRedeliverRequests()).toEqual([]);
  });

  it('should throw `missing_parameter` naming --delivery when none is given and nobody can be asked', async () => {
    respondWithWebhook();

    await expect(
      webhookDeliveryRedeliverCommand.action(
        { organization: ACME_ORGANIZATION.id, webhook: WEBHOOK.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--delivery'));
  });
});
