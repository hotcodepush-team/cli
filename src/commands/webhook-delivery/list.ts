import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveTimeBound } from '../../utils/duration.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import {
  fetchWebhook,
  webhookOptionShape,
} from '../../utils/webhook-resolution.js';
import { resolveResponseText } from './redeliver.js';

export default defineCommand({
  description:
    "List a webhook's deliveries, newest first, filtered by status and time, to find the ones worth redelivering; each is kept for 30 days.",
  examples: [
    'hotcodepush webhook-delivery list --webhook releases --status failed --created-since 2h',
    'hotcodepush webhook-delivery list --webhook releases --json',
  ],
  options: defineCommandOptions({
    ...paginationShape,
    ...webhookOptionShape,
    createdSince: z
      .string()
      .optional()
      .describe(
        'The earliest delivery, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    createdUntil: z
      .string()
      .optional()
      .describe(
        'The latest delivery, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    status: z
      .enum(['failed', 'pending', 'succeeded'])
      .optional()
      .describe('failed, pending while it is retried, or succeeded.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedWebhook = await fetchWebhook(hotCodePush, options);
    const listedDeliveries =
      await hotCodePush.organizations.webhooks.deliveries.list({
        createdSince: resolveTimeBound(options.createdSince),
        createdUntil: resolveTimeBound(options.createdUntil),
        limit: options.limit,
        offset: options.offset,
        organizationId: fetchedWebhook.organizationId,
        status: options.status,
        webhookId: fetchedWebhook.id,
      });
    const nextOffset = resolveNextOffset(listedDeliveries.length, options);
    if (options.json) {
      printJson({ nextOffset, webhookDeliveries: listedDeliveries });
      return;
    }
    printTable({
      emptyText: 'No deliveries match.',
      headers: ['ID', 'TIME', 'TYPE', 'STATUS', 'RESPONSE', 'ATTEMPTS'],
      nextOffset,
      rows: listedDeliveries.map(delivery => [
        delivery.id,
        delivery.createdAt,
        delivery.type,
        delivery.status,
        resolveResponseText(delivery),
        String(delivery.attemptCount),
      ]),
    });
  },
});
