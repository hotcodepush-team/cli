import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  FAILED_WEBHOOK_DELIVERY,
  WEBHOOK,
} from '../../../test/fixtures.js';
import webhookDeliveryListCommand from './list.js';

const WEBHOOKS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/webhooks`;

const DELIVERIES_PATH = `${WEBHOOKS_PATH}/${WEBHOOK.id}/deliveries`;

describe('webhook-delivery list', () => {
  const harness = useCommandHarness();

  function readListUrl(): URL | undefined {
    return harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === DELIVERIES_PATH);
  }

  function respondWithWebhook(): void {
    harness.routes[`GET ${WEBHOOKS_PATH}`] = () => Response.json([WEBHOOK]);
    harness.routes[`GET ${WEBHOOKS_PATH}/${WEBHOOK.id}`] = () =>
      Response.json(WEBHOOK);
  }

  it('should list the deliveries with their time, type, status, answer and attempts', async () => {
    respondWithWebhook();
    harness.routes[`GET ${DELIVERIES_PATH}`] = () =>
      Response.json([
        FAILED_WEBHOOK_DELIVERY,
        {
          ...FAILED_WEBHOOK_DELIVERY,
          attemptCount: 1,
          nextAttemptAt: '2026-09-12T09:05:00.000Z',
          responseBody: null,
          responseCode: null,
          status: 'pending',
        },
      ]);

    await webhookDeliveryListCommand.action(
      { organization: ACME_ORGANIZATION.id, webhook: 'releases' },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'ID                                    TIME                      TYPE             STATUS   RESPONSE     ATTEMPTS',
      `${FAILED_WEBHOOK_DELIVERY.id}  2026-09-12T09:00:00.000Z  release.created  failed   HTTP 500     3`,
      `${FAILED_WEBHOOK_DELIVERY.id}  2026-09-12T09:00:00.000Z  release.created  pending  no response  1`,
    ]);
  });

  it('should send the status and a duration as the timestamp it reaches back to', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-12T12:00:00.000Z') });
    respondWithWebhook();
    harness.routes[`GET ${DELIVERIES_PATH}`] = () => Response.json([]);

    await webhookDeliveryListCommand.action(
      {
        createdSince: '2h',
        organization: ACME_ORGANIZATION.id,
        status: 'failed',
        webhook: WEBHOOK.id,
      },
      undefined,
    );
    vi.useRealTimers();

    expect(Object.fromEntries(readListUrl()?.searchParams ?? [])).toEqual({
      createdSince: '2026-09-12T10:00:00.000Z',
      status: 'failed',
    });
    expect(harness.readLines()).toEqual(['No deliveries match.']);
  });

  it('should print the page as served and the next offset when --json is passed', async () => {
    respondWithWebhook();
    harness.routes[`GET ${DELIVERIES_PATH}`] = () =>
      Response.json([FAILED_WEBHOOK_DELIVERY]);

    await webhookDeliveryListCommand.action(
      {
        json: true,
        limit: 1,
        organization: ACME_ORGANIZATION.id,
        webhook: WEBHOOK.id,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      nextOffset: 1,
      webhookDeliveries: [FAILED_WEBHOOK_DELIVERY],
    });
  });
});
