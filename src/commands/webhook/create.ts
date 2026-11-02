import type { CreatedWebhook, CreateWebhookOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { fetchOrganizationId } from '../../resources/organizations.js';
import {
  fetchWebhookAppId,
  resolveWebhookEventTypes,
  webhookAppOptionShape,
  webhookEventOptionShape,
} from '../../resources/webhooks.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printWarning } from '../../utils/diagnostics.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import type { Detail } from '../../utils/output.js';
import { printJson, printResult } from '../../utils/output.js';
import { promptSelect, promptText } from '../../utils/prompts.js';

type WebhookFormat = CreateWebhookOptions['format'];

const WEBHOOK_FORMATS = ['raw', 'slack', 'discord', 'teams'] as const;

export default defineCommand({
  description:
    "Create a webhook that posts the organization's events to a URL, as signed JSON or as a Slack, Discord or Teams message. A raw webhook's secret is printed this once.",
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
      (await promptText(options, {
        flag: '--name',
        message: 'What is the webhook called?',
      }));
    const url =
      options.url ??
      (await promptText(options, {
        flag: '--url',
        message: 'Which URL receives the events?',
      }));
    const format = options.format ?? (await promptFormat(options));
    const events = options.event?.length
      ? options.event
      : [await promptEventType(options)];
    const createdWebhook = await hotCodePush.organizations.webhooks.create({
      appId:
        options.app === undefined
          ? undefined
          : await fetchWebhookAppId(hotCodePush, {
              app: options.app,
              organizationId,
            }),
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
  printResult({
    rows: [
      ['ID', webhook.id],
      ...(webhook.secret === null
        ? []
        : [['Secret', webhook.secret] as Detail]),
    ],
    sentence: `Created webhook ${webhook.name}.`,
  });
  if (webhook.secret === null) {
    return;
  }
  printWarning(
    'Store the secret now to verify the signature of every delivery. It is never shown again.',
  );
}

function promptEventType(options: InteractivityOptions): Promise<string> {
  return promptText(options, {
    flag: '--event',
    message: 'Which event type, such as release.created?',
  });
}

function promptFormat(options: InteractivityOptions): Promise<WebhookFormat> {
  return promptSelect(options, {
    choices: WEBHOOK_FORMATS.map(format => ({ label: format, value: format })),
    flag: '--format',
    message: 'Which format?',
  });
}
