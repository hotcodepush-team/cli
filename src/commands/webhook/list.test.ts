import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, WEBHOOK } from '../../../test/fixtures.js';
import webhookListCommand from './list.js';

const WEBHOOKS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks`;

describe('webhook list', () => {
  const harness = useCommandHarness();

  it('should list the webhooks with their format, URL and whether they are enabled', async () => {
    harness.routes[`GET ${WEBHOOKS_PATH}`] = () =>
      Response.json([
        WEBHOOK,
        {
          ...WEBHOOK,
          format: 'slack',
          disabledAt: '2026-09-14T10:00:00.000Z',
          name: 'team-chat',
        },
      ]);

    await webhookListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'ID                                    NAME       FORMAT  URL                                    DISABLED AT  CREATED',
      `${WEBHOOK.id}  releases   raw     ${WEBHOOK.url}  none         2026-09-12`,
      `${WEBHOOK.id}  team-chat  slack   ${WEBHOOK.url}  2026-09-14   2026-09-12`,
    ]);
  });

  it('should print the page as served and the next offset when --json is passed', async () => {
    harness.routes[`GET ${WEBHOOKS_PATH}?limit=1&offset=0`] = () =>
      Response.json([WEBHOOK]);

    await webhookListCommand.action(
      { json: true, limit: 1, offset: 0, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual({ nextOffset: 1, webhooks: [WEBHOOK] });
  });
});
