import type {
  CreateWebhookOptions,
  HotCodePush,
  Webhook,
} from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from '../utils/environment.js';
import { fetchAllPages } from '../utils/pagination.js';
import {
  fetchOrPromptResourceId,
  fetchResourceId,
} from '../utils/resources.js';
import { fetchApps } from './apps.js';
import { fetchOrganizationId } from './organizations.js';

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
      "The app, by id or name, whose events alone the webhook receives. Defaults to every app's and the organization's events, never to hotcodepush.json's app.",
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
    webhookId: await fetchWebhookId(hotCodePush, { options, organizationId }),
  });
}

export function fetchWebhookAppId(
  hotCodePush: HotCodePush,
  { app, organizationId }: { app: string; organizationId: string },
): Promise<string> {
  return fetchResourceId({
    fetchResources: () => fetchApps(hotCodePush, organizationId),
    noun: 'app',
    reference: app,
  });
}

// The API checks the types against its catalog and names the one it refuses.
export function resolveWebhookEventTypes(events: string[]): WebhookEventType[] {
  return events as WebhookEventType[];
}

async function fetchWebhookId(
  hotCodePush: HotCodePush,
  {
    options,
    organizationId,
  }: { options: WebhookOptions; organizationId: string },
): Promise<string> {
  return fetchOrPromptResourceId({
    fetchResources: () => fetchWebhooks(hotCodePush, organizationId),
    noun: 'webhook',
    options,
    reference: options.webhook,
  });
}

function fetchWebhooks(
  hotCodePush: HotCodePush,
  organizationId: string,
): Promise<Webhook[]> {
  return fetchAllPages(page =>
    hotCodePush.organizations.webhooks.list({ organizationId, ...page }),
  );
}
