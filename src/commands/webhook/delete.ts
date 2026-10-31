import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchWebhook,
  webhookOptionShape,
} from '../../utils/webhook-resolution.js';

export default defineCommand({
  description: 'Delete a webhook and its delivery log.',
  examples: [
    'hotcodepush webhook delete --webhook releases',
    'hotcodepush webhook delete --webhook team-chat --yes --json',
  ],
  options: defineCommandOptions(webhookOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedWebhook = await fetchWebhook(hotCodePush, options);
    const isConfirmed = await confirmConsequence(
      `deletes webhook ${fetchedWebhook.name} and its delivery log: ${fetchedWebhook.url} receives no more events`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.organizations.webhooks.delete({
      organizationId: fetchedWebhook.organizationId,
      webhookId: fetchedWebhook.id,
    });
    if (options.json) {
      printJson({ id: fetchedWebhook.id, name: fetchedWebhook.name });
    } else {
      console.log(
        `Deleted webhook ${fetchedWebhook.name} (${fetchedWebhook.id}).`,
      );
    }
  },
});
