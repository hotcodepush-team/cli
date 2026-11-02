import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  WEBHOOK,
} from '../../../test/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import { select, text } from '../../utils/prompt-renderers.js';
import webhookCreateCommand from './create.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const WEBHOOKS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks`;

const SECRET = 'invented-webhook-secret';

describe('webhook create', () => {
  const harness = useCommandHarness();

  function readCreateRequest(): Request | undefined {
    return harness.requests.find(({ method }) => method === 'POST');
  }

  function respondWithCreatedWebhook(secret: string | null): void {
    harness.routes[`POST ${WEBHOOKS_PATH}`] = () =>
      Response.json({ ...WEBHOOK, secret }, { status: 201 });
  }

  it('should create the webhook with every event and print its secret this once', async () => {
    respondWithCreatedWebhook(SECRET);

    await webhookCreateCommand.action(
      {
        event: ['release.created', 'release.paused'],
        format: 'raw',
        name: 'releases',
        organization: ACME_ORGANIZATION.id,
        url: WEBHOOK.url,
      },
      undefined,
    );

    expect(await readCreateRequest()?.json()).toEqual({
      events: ['release.created', 'release.paused'],
      format: 'raw',
      name: 'releases',
      url: WEBHOOK.url,
    });
    expect(harness.readLines()).toEqual([
      'Created webhook releases.',
      `ID      ${WEBHOOK.id}`,
      `Secret  ${SECRET}`,
    ]);
    expect(harness.readDiagnostics()).toBe(
      'Store the secret now to verify the signature of every delivery. It is never shown again.\n',
    );
  });

  it('should send the app filter by its id among the apps of the organization and print no secret for a chat format', async () => {
    harness.routes[`GET ${WEBHOOKS_PATH.replace('/webhooks', '/apps')}`] = () =>
      Response.json([DEMO_APP]);
    respondWithCreatedWebhook(null);

    await webhookCreateCommand.action(
      {
        app: DEMO_APP.name,
        event: ['release.failure_rate_exceeded'],
        format: 'slack',
        name: 'releases',
        organization: ACME_ORGANIZATION.id,
        url: WEBHOOK.url,
      },
      undefined,
    );

    expect(await readCreateRequest()?.json()).toMatchObject({
      appId: DEMO_APP.id,
      format: 'slack',
    });
    expect(harness.readLines()).toEqual([
      'Created webhook releases.',
      `ID  ${WEBHOOK.id}`,
    ]);
    expect(harness.readDiagnostics()).toBe('');
  });

  it('should print the created row with its secret as served when --json is passed', async () => {
    respondWithCreatedWebhook(SECRET);

    await webhookCreateCommand.action(
      {
        event: ['release.created'],
        format: 'raw',
        json: true,
        name: 'releases',
        organization: ACME_ORGANIZATION.id,
        url: WEBHOOK.url,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({ ...WEBHOOK, secret: SECRET });
    expect(harness.readLines()).toEqual([]);
  });

  it('should ask for the name, URL, format and one event when interactive', async () => {
    stubInteractiveTerminal();
    vi.mocked(text)
      .mockResolvedValueOnce('releases')
      .mockResolvedValueOnce(WEBHOOK.url)
      .mockResolvedValueOnce('release.created');
    vi.mocked(select).mockResolvedValue('discord');
    respondWithCreatedWebhook(null);

    await webhookCreateCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(await readCreateRequest()?.json()).toEqual({
      events: ['release.created'],
      format: 'discord',
      name: 'releases',
      url: WEBHOOK.url,
    });
  });

  it('should throw `missing_parameter` naming --event and create nothing when no event is given and nobody can be asked', async () => {
    respondWithCreatedWebhook(SECRET);

    await expect(
      webhookCreateCommand.action(
        {
          format: 'raw',
          name: 'releases',
          organization: ACME_ORGANIZATION.id,
          url: WEBHOOK.url,
        },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--event'));
    expect(readCreateRequest()).toBeUndefined();
  });
});
