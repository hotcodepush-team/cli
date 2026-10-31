import type {
  CreateWebhookOptions,
  HotCodePush,
  Webhook,
} from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { MissingParameterError } from './errors.js';
import { fetchAllPages } from './pagination.js';
import {
  fetchApps,
  fetchOrganizationId,
  fetchResourceId,
  promptResourceId,
} from './resource-resolution.js';

type WebhookEventType = CreateWebhookOptions['events'][number];

interface WebhookOptions extends InteractivityOptions {
  organization?: string;
  webhook?: string;
}

export const webhookAppOptionShape = {
  app: z
    .string()
    .optional()
    .describe(
      "The app, by id or name, whose events alone the webhook receives; every app's and the organization's by default, never hotcodepush.json's app.",
    ),
};

export const webhookEventOptionShape = {
  event: z
    .array(z.string())
    .optional()
    .describe(
      'An event type the webhook receives, such as release.created, repeatable.',
    ),
};

export const webhookOptionShape = {
  webhook: z.string().optional().describe('The webhook, by id or name.'),
};

// The name is unique in the organization, so it names a webhook the way a name does an app.
export async function fetchWebhook(
  hotCodePush: HotCodePush,
  options: WebhookOptions,
): Promise<Webhook> {
  const organizationId = await fetchOrganizationId(hotCodePush, options);
  return hotCodePush.organizations.webhooks.get({
    organizationId,
    webhookId: await fetchWebhookId(hotCodePush, organizationId, options),
  });
}

export function fetchWebhookAppId(
  hotCodePush: HotCodePush,
  organizationId: string,
  app: string,
): Promise<string> {
  return fetchResourceId('app', app, () =>
    fetchApps(hotCodePush, organizationId),
  );
}

// The API checks the types against its catalog and names the one it refuses.
export function resolveWebhookEventTypes(events: string[]): WebhookEventType[] {
  return events as WebhookEventType[];
}

async function fetchWebhookId(
  hotCodePush: HotCodePush,
  organizationId: string,
  options: WebhookOptions,
): Promise<string> {
  if (options.webhook !== undefined) {
    return fetchResourceId('webhook', options.webhook, () =>
      fetchWebhooks(hotCodePush, organizationId),
    );
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError('--webhook');
  }
  return promptResourceId(
    'webhook',
    await fetchWebhooks(hotCodePush, organizationId),
    options,
  );
}

function fetchWebhooks(
  hotCodePush: HotCodePush,
  organizationId: string,
): Promise<Webhook[]> {
  return fetchAllPages(page =>
    hotCodePush.organizations.webhooks.list({ organizationId, ...page }),
  );
}
