import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  WEBHOOK,
} from '../../../test/fixtures.js';
import { InvalidParameterError } from '../../utils/errors.js';
import webhookUpdateCommand from './update.js';

const WEBHOOKS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks`;

const WEBHOOK_PATH = `${WEBHOOKS_PATH}/${WEBHOOK.id}`;

describe('webhook update', () => {
  const harness = useCommandHarness();

  function readUpdateRequest(): Request | undefined {
    return harness.requests.find(({ method }) => method === 'PATCH');
  }

  function respondWithWebhook(): void {
    harness.routes[`GET ${WEBHOOKS_PATH}`] = () => Response.json([WEBHOOK]);
    harness.routes[`GET ${WEBHOOK_PATH}`] = () => Response.json(WEBHOOK);
    harness.routes[`PATCH ${WEBHOOK_PATH}`] = () =>
      Response.json({ ...WEBHOOK, name: 'deploys' });
  }

  it('should send only the fields the flags name, the app by its id, and print the new name', async () => {
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);
    respondWithWebhook();

    await webhookUpdateCommand.action(
      {
        app: DEMO_APP.name,
        enabled: true,
        event: ['release.revoked'],
        name: 'deploys',
        organization: ACME_ORGANIZATION.id,
        webhook: 'releases',
      },
      undefined,
    );

    expect(await readUpdateRequest()?.json()).toEqual({
      appId: DEMO_APP.id,
      events: ['release.revoked'],
      isEnabled: true,
      name: 'deploys',
    });
    expect(harness.readLines()).toEqual([
      `Updated webhook deploys (${WEBHOOK.id}).`,
    ]);
  });

  it('should send a null app filter for --clear-app and print the row as served when --json is passed', async () => {
    respondWithWebhook();

    await webhookUpdateCommand.action(
      {
        clearApp: true,
        json: true,
        organization: ACME_ORGANIZATION.id,
        webhook: WEBHOOK.id,
      },
      undefined,
    );

    expect(await readUpdateRequest()?.json()).toEqual({ appId: null });
    expect(harness.readJson()).toEqual({ ...WEBHOOK, name: 'deploys' });
  });

  it('should refuse --app and --clear-app together before any request', async () => {
    await expect(
      webhookUpdateCommand.action(
        {
          app: DEMO_APP.id,
          clearApp: true,
          organization: ACME_ORGANIZATION.id,
          webhook: WEBHOOK.id,
        },
        undefined,
      ),
    ).rejects.toThrow(InvalidParameterError);
    expect(harness.requests).toEqual([]);
  });
});
