import type { CreatedWebhook, CreateWebhookOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { promptSelect, promptText } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import {
  fetchWebhookAppId,
  resolveWebhookEventTypes,
  webhookAppOptionShape,
  webhookEventOptionShape,
} from '../../utils/webhook-resolution.js';

type WebhookFormat = CreateWebhookOptions['format'];

const WEBHOOK_FORMATS = ['raw', 'slack', 'discord', 'teams'] as const;

export default defineCommand({
  description:
    "Create a webhook that posts the organization's events to a URL, as signed JSON or as a Slack, Discord or Teams message; a raw webhook's secret is printed this once.",
  examples: [
    'hotcodepush webhook create --name releases --url https://example.com/hooks/hotcodepush --format raw --event release.created --event release.paused',
    'hotcodepush webhook create --name team-chat --url https://chat.example.com/incoming/team --format slack --event release.failure_rate_exceeded --app "My App" --json',
  ],
  options: defineCommandOptions({
    ...webhookAppOptionShape,
    ...webhookEventOptionShape,
    format: z
      .enum(WEBHOOK_FORMATS)
      .optional()
      .describe(
        "raw for HotCodePush's signed JSON, slack, discord or teams for a message to that service's incoming-webhook URL.",
      ),
    name: z
      .string()
      .optional()
      .describe('The name, unique in the organization.'),
    url: z
      .string()
      .optional()
      .describe('The https URL the events are posted to.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const name =
      options.name ??
      (await promptText('--name', 'What is the webhook called?', options));
    const url =
      options.url ??
      (await promptText('--url', 'Which URL receives the events?', options));
    const format = options.format ?? (await promptFormat(options));
    const events = options.event?.length
      ? options.event
      : [
          await promptText(
            '--event',
            'Which event type, such as release.created?',
            options,
          ),
        ];
    const createdWebhook = await hotCodePush.organizations.webhooks.create({
      appId:
        options.app === undefined
          ? undefined
          : await fetchWebhookAppId(hotCodePush, organizationId, options.app),
      events: resolveWebhookEventTypes(events),
      format,
      name,
      organizationId,
      url,
    });
    if (options.json) {
      printJson(createdWebhook);
      return;
    }
    printCreatedWebhook(createdWebhook);
  },
});

function printCreatedWebhook(webhook: CreatedWebhook): void {
  console.log(`Created webhook ${webhook.name} (${webhook.id}).`);
  if (webhook.secret === null) {
    return;
  }
  console.log(`Secret: ${webhook.secret}`);
  console.log(
    'Store the secret now to verify the signature of every delivery; it is never shown again.',
  );
}

function promptFormat(options: InteractivityOptions): Promise<WebhookFormat> {
  return promptSelect(
    '--format',
    'Which format?',
    WEBHOOK_FORMATS.map(format => ({ label: format, value: format })),
    options,
  );
}
