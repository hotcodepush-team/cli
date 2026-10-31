import type { WebhookDelivery } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence, promptText } from '../../utils/prompts.js';
import {
  fetchWebhook,
  webhookOptionShape,
} from '../../utils/webhook-resolution.js';

export default defineCommand({
  description:
    "Deliver a webhook's event again, once, and print the receiver's answer; a pending delivery is taken from the retries.",
  examples: [
    'hotcodepush webhook-delivery redeliver --webhook releases --delivery 9a4f2e71-3b8c-4d65-b1e7-0c2d5f8a6e93',
    'hotcodepush webhook-delivery redeliver --webhook releases --delivery 9a4f2e71-3b8c-4d65-b1e7-0c2d5f8a6e93 --yes --json',
  ],
  options: defineCommandOptions({
    ...webhookOptionShape,
    delivery: z
      .string()
      .optional()
      .describe(
        'The delivery, by id, as "hotcodepush webhook-delivery list" prints it.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedWebhook = await fetchWebhook(hotCodePush, options);
    // A delivery has no name to pick from, so a missing one is asked for as text.
    const deliveryId =
      options.delivery ??
      (await promptText('--delivery', 'Which delivery id?', options));
    const isConfirmed = await confirmConsequence(
      `sends the event of delivery ${deliveryId} to ${fetchedWebhook.url} again`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const settledDelivery =
      await hotCodePush.organizations.webhooks.deliveries.redeliver({
        deliveryId,
        organizationId: fetchedWebhook.organizationId,
        webhookId: fetchedWebhook.id,
      });
    if (options.json) {
      printJson(settledDelivery);
      return;
    }
    printSettledDelivery(settledDelivery, fetchedWebhook.name);
  },
});

export function printSettledDelivery(
  delivery: WebhookDelivery,
  webhookName: string,
): void {
  console.log(
    `Sent ${delivery.type} to webhook ${webhookName}: ${delivery.status}, ${resolveResponseText(delivery)}.`,
  );
}

export function resolveResponseText({ responseCode }: WebhookDelivery): string {
  return responseCode === null ? 'no response' : `HTTP ${responseCode}`;
}
