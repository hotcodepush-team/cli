import type {
  TelemetryExportDelivery,
  WebhookDelivery,
} from '@hotcodepush/node';
import { printResult } from './output.js';

type Delivery = TelemetryExportDelivery | WebhookDelivery;

export function printSettledDelivery(
  delivery: Delivery,
  { targetLabel }: { targetLabel: string },
): void {
  printResult({
    rows: [
      ['ID', delivery.id],
      ['Status', delivery.status],
      ['Response', resolveResponseText(delivery)],
    ],
    sentence: `Sent ${delivery.type} to ${targetLabel}.`,
  });
}

export function resolveResponseText({ responseCode }: Delivery): string {
  return responseCode === null ? 'no response' : `HTTP ${responseCode}`;
}
