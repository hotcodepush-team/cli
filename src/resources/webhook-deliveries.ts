import type { WebhookDelivery } from '@hotcodepush/node';
import { printResult } from '../utils/output.js';

export function printSettledDelivery(
  delivery: WebhookDelivery,
  webhookName: string,
): void {
  printResult({
    rows: [
      ['ID', delivery.id],
      ['Status', delivery.status],
      ['Response', resolveResponseText(delivery)],
    ],
    sentence: `Sent ${delivery.type} to webhook ${webhookName}.`,
  });
}

export function resolveResponseText({ responseCode }: WebhookDelivery): string {
  return responseCode === null ? 'no response' : `HTTP ${responseCode}`;
}
