import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, WEBHOOK } from '../../../test/fixtures.js';
import { MissingParameterError, UnknownNameError } from '../../utils/errors.js';
import webhookGetCommand from './get.js';

const WEBHOOKS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks`;

describe('webhook get', () => {
  const harness = useCommandHarness();

  function respondWithWebhook(): void {
    harness.routes[`GET ${WEBHOOKS_PATH}`] = () => Response.json([WEBHOOK]);
    harness.routes[`GET ${WEBHOOKS_PATH}/${WEBHOOK.id}`] = () =>
      Response.json(WEBHOOK);
  }

  it('should print the webhook found by its name, case-insensitively', async () => {
    respondWithWebhook();

    await webhookGetCommand.action(
      { organization: ACME_ORGANIZATION.id, webhook: 'Releases' },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID                    ${WEBHOOK.id}`,
      'Name                  releases',
      `URL                   ${WEBHOOK.url}`,
      'Format                raw',
      'Events                release.created, release.paused',
      'App                   every app',
      'Enabled               yes',
      'Consecutive failures  0',
      `Created               ${WEBHOOK.createdAt}`,
    ]);
  });

  it('should read the webhook by its id without listing and print the row as served when --json is passed', async () => {
    respondWithWebhook();

    await webhookGetCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id, webhook: WEBHOOK.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(WEBHOOK);
    expect(harness.requests.map(({ url }) => new URL(url).pathname)).toEqual([
      `${WEBHOOKS_PATH}/${WEBHOOK.id}`,
    ]);
  });

  it('should throw `invalid_parameter` when no webhook has the name', async () => {
    respondWithWebhook();

    await expect(
      webhookGetCommand.action(
        { organization: ACME_ORGANIZATION.id, webhook: 'deploys' },
        undefined,
      ),
    ).rejects.toThrow(new UnknownNameError('webhook', 'deploys'));
  });

  it('should throw `missing_parameter` naming --webhook when none is given and nobody can be asked', async () => {
    await expect(
      webhookGetCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--webhook'));
  });
});
