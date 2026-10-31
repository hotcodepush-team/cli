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
import { ConfirmationRequiredError } from '../../utils/errors.js';
import webhookTestCommand from './test.js';

vi.mock('@clack/prompts');

const WEBHOOK_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks/${WEBHOOK.id}`;

const CONSEQUENCE = `sends a sample event to ${WEBHOOK.url}`;

const OPTIONS = { organization: ACME_ORGANIZATION.id, webhook: WEBHOOK.id };

const TEST_DELIVERY = {
  ...FAILED_WEBHOOK_DELIVERY,
  attemptCount: 1,
  auditRowId: null,
  responseBody: 'ok',
  responseCode: 200,
  status: 'succeeded',
  type: 'webhook.test',
};

describe('webhook test', () => {
  const harness = useCommandHarness();

  function readTestRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'POST');
  }

  function respondWithWebhook(): void {
    harness.routes[`GET ${WEBHOOK_PATH}`] = () => Response.json(WEBHOOK);
    harness.routes[`POST ${WEBHOOK_PATH}/test`] = () =>
      Response.json(TEST_DELIVERY, { status: 201 });
  }

  it("should send the sample event once confirmed and print the receiver's answer", async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithWebhook();

    await webhookTestCommand.action(OPTIONS, undefined);

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This ${CONSEQUENCE}. Continue?`,
    });
    expect(readTestRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      'Sent webhook.test to webhook releases: succeeded, HTTP 200.',
    ]);
  });

  it('should send nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithWebhook();

    await webhookTestCommand.action(OPTIONS, undefined);

    expect(readTestRequests()).toEqual([]);
  });

  it('should send without asking and print the delivery as served when --yes and --json are passed', async () => {
    respondWithWebhook();

    await webhookTestCommand.action(
      { ...OPTIONS, json: true, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual(TEST_DELIVERY);
  });

  it('should throw `confirmation_required` with the consequence and send nothing when nobody can be asked', async () => {
    respondWithWebhook();

    await expect(webhookTestCommand.action(OPTIONS, undefined)).rejects.toThrow(
      new ConfirmationRequiredError(CONSEQUENCE),
    );
    expect(readTestRequests()).toEqual([]);
  });
});
