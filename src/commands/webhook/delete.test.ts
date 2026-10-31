import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, WEBHOOK } from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import webhookDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const WEBHOOK_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks/${WEBHOOK.id}`;

const CONSEQUENCE = `deletes webhook releases and its delivery log: ${WEBHOOK.url} receives no more events`;

const OPTIONS = { organization: ACME_ORGANIZATION.id, webhook: WEBHOOK.id };

describe('webhook delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithWebhook(): void {
    harness.routes[`GET ${WEBHOOK_PATH}`] = () => Response.json(WEBHOOK);
    harness.routes[`DELETE ${WEBHOOK_PATH}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should delete the webhook once confirmed, stating that its URL receives no more events', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithWebhook();

    await webhookDeleteCommand.action(OPTIONS, undefined);

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This ${CONSEQUENCE}. Continue?`,
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Deleted webhook releases (${WEBHOOK.id}).`,
    ]);
  });

  it('should delete nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithWebhook();

    await webhookDeleteCommand.action(OPTIONS, undefined);

    expect(readDeleteRequests()).toEqual([]);
  });

  it('should delete without asking and print the id and name of what went when --yes and --json are passed', async () => {
    respondWithWebhook();

    await webhookDeleteCommand.action(
      { ...OPTIONS, json: true, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readJson()).toEqual({ id: WEBHOOK.id, name: 'releases' });
  });

  it('should throw `confirmation_required` with the consequence and delete nothing when nobody can be asked', async () => {
    respondWithWebhook();

    await expect(
      webhookDeleteCommand.action({ ...OPTIONS, json: true }, undefined),
    ).rejects.toThrow(new ConfirmationRequiredError(CONSEQUENCE));
    expect(readDeleteRequests()).toEqual([]);
  });
});
