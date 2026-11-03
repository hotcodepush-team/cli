import { z } from 'zod';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { resolveResponseText } from '../../utils/deliveries.js';
import { resolveTimeBound } from '../../utils/duration.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';

export default defineCommand({
  description:
    "List the telemetry export's deliveries, newest first, filtered by status and time, to find the ones worth redelivering. Each is kept for 30 days.",
  examples: [
    'hotcodepush telemetry-export-delivery list --status failed --created-since 2h',
    'hotcodepush telemetry-export-delivery list --organization Acme --json',
  ],
  options: defineCommandOptions({
    ...paginationShape,
    createdSince: z
      .string()
      .optional()
      .describe(
        'The earliest delivery, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    createdUntil: z
      .string()
      .optional()
      .describe(
        'The latest delivery, inclusive: an ISO 8601 timestamp or a duration ago such as 2h or 7d.',
      ),
    status: z
      .enum(['failed', 'pending', 'succeeded'])
      .optional()
      .describe('failed, pending while it is retried, or succeeded.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedDeliveries =
      await hotCodePush.organizations.telemetryExport.deliveries.list({
        createdSince: resolveTimeBound(options.createdSince),
        createdUntil: resolveTimeBound(options.createdUntil),
        limit: options.limit,
        offset: options.offset,
        organizationId: await fetchOrganizationId(hotCodePush, options),
        status: options.status,
      });
    const nextOffset = resolveNextOffset(listedDeliveries.length, options);
    if (options.json) {
      printJson({ nextOffset, telemetryExportDeliveries: listedDeliveries });
      return;
    }
    printTable({
      emptyText: 'No deliveries match.',
      headers: ['ID', 'TIME', 'TYPE', 'STATUS', 'RESPONSE', 'ATTEMPTS'],
      nextOffset,
      rows: listedDeliveries.map(delivery => [
        delivery.id,
        delivery.createdAt,
        delivery.type,
        delivery.status,
        resolveResponseText(delivery),
        String(delivery.attemptCount),
      ]),
    });
  },
});
