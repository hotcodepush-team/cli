import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable } from '../../utils/output.js';
import { resolveByteText } from '../../utils/progress.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "Print an organization's monthly active devices and bytes per app in a month, with the total the invoice counts.",
  examples: [
    'hotcodepush usage get',
    'hotcodepush usage get --organization Acme --month 2026-09 --json',
  ],
  options: defineCommandOptions({
    month: z
      .string()
      .optional()
      .describe(
        'The month, YYYY-MM; the current one by default, its devices counted live.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedUsage = await hotCodePush.organizations.usage.get({
      month: options.month,
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    if (options.json) {
      printJson(fetchedUsage);
      return;
    }
    printTable({
      emptyText: `No usage in ${fetchedUsage.month}.`,
      headers: ['APP', 'MAU', 'BYTES'],
      nextOffset: null,
      rows: [
        ...fetchedUsage.apps.map(({ appName, bytes, mau }) => [
          appName,
          String(mau),
          resolveByteText(bytes),
        ]),
        [
          `Total in ${fetchedUsage.month}`,
          String(fetchedUsage.total.mau),
          resolveByteText(fetchedUsage.total.bytes),
        ],
      ],
    });
  },
});
