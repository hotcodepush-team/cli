import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchWebhook,
  webhookOptionShape,
} from '../../utils/webhook-resolution.js';
import { printSettledDelivery } from '../webhook-delivery/redeliver.js';

export default defineCommand({
  description:
    "Send one sample event, webhook.test, to a webhook's URL and print the receiver's answer.",
  examples: [
    'hotcodepush webhook test --webhook releases',
    'hotcodepush webhook test --webhook team-chat --yes --json',
  ],
  options: defineCommandOptions(webhookOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedWebhook = await fetchWebhook(hotCodePush, options);
    const isConfirmed = await confirmConsequence(
      `sends a sample event to ${fetchedWebhook.url}`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const settledDelivery = await hotCodePush.organizations.webhooks.test({
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
