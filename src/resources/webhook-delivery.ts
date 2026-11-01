import type { WebhookDelivery } from '@hotcodepush/node';

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
