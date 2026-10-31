import type { Webhook } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import {
  fetchWebhook,
  webhookOptionShape,
} from '../../utils/webhook-resolution.js';

export default defineCommand({
  description:
    'Print a webhook: its URL, format, events, app filter and whether it is enabled; never its secret.',
  examples: [
    'hotcodepush webhook get --webhook releases',
    'hotcodepush webhook get --webhook 3c9e7a52-8d14-4b6f-a0e2-5f71c3d8b946 --json',
  ],
  options: defineCommandOptions(webhookOptionShape),
  action: async options => {
    const fetchedWebhook = await fetchWebhook(createApiClient(), options);
    if (options.json) {
      printJson(fetchedWebhook);
      return;
    }
    printWebhookDetails(fetchedWebhook);
  },
});

function printWebhookDetails(webhook: Webhook): void {
  printDetails([
    ['ID', webhook.id],
    ['Name', webhook.name],
    ['URL', webhook.url],
    ['Format', webhook.format],
    ['Events', webhook.events.join(', ')],
    ['App', webhook.appId ?? 'every app'],
    ['Enabled', webhook.isEnabled ? 'yes' : 'no'],
    ['Consecutive failures', String(webhook.consecutiveFailureCount)],
    ['Created', webhook.createdAt],
  ]);
}
