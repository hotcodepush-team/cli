import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveNullableField } from '../../utils/nullable-field.js';
import { printJson } from '../../utils/output.js';
import {
  fetchWebhook,
  fetchWebhookAppId,
  resolveWebhookEventTypes,
  webhookAppOptionShape,
  webhookEventOptionShape,
  webhookOptionShape,
} from '../../utils/webhook-resolution.js';

export default defineCommand({
  description:
    'Rename a webhook or change its URL, events, app filter or whether it is enabled; the format and the secret never change.',
  examples: [
    'hotcodepush webhook update --webhook releases --event release.created --event release.revoked',
    'hotcodepush webhook update --webhook team-chat --enabled --clear-app --json',
  ],
  options: defineCommandOptions({
    ...webhookAppOptionShape,
    ...webhookEventOptionShape,
    ...webhookOptionShape,
    clearApp: z
      .boolean()
      .optional()
      .describe(
        "Sets the app filter back to null: the webhook receives every app's events and the organization's.",
      ),
    enabled: booleanFlagSchema
      .optional()
      .describe(
        'Whether the webhook delivers; turning it on again restarts the count of failures that disables it. Pass false to turn it off.',
      ),
    name: z.string().optional().describe("The webhook's new name."),
    url: z
      .string()
      .optional()
      .describe('The https URL the events are posted to.'),
  }),
  action: async options => {
    const app = resolveNullableField(options.app, options.clearApp, 'app');
    const hotCodePush = createApiClient();
    const fetchedWebhook = await fetchWebhook(hotCodePush, options);
    const updatedWebhook = await hotCodePush.organizations.webhooks.update({
      appId:
        typeof app === 'string'
          ? await fetchWebhookAppId(
              hotCodePush,
              fetchedWebhook.organizationId,
              app,
            )
          : app,
      events:
        options.event === undefined
          ? undefined
          : resolveWebhookEventTypes(options.event),
      isEnabled: options.enabled,
      name: options.name,
      organizationId: fetchedWebhook.organizationId,
      url: options.url,
      webhookId: fetchedWebhook.id,
    });
    if (options.json) {
      printJson(updatedWebhook);
    } else {
      console.log(
        `Updated webhook ${updatedWebhook.name} (${updatedWebhook.id}).`,
      );
    }
  },
});
