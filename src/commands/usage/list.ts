import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { resolveByteText } from '../../utils/progress.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import { monthOptionShape } from '../../utils/usage-month.js';

export default defineCommand({
  description:
    "List an organization's apps with their monthly active devices and data transfer in a month, the most devices first.",
  examples: [
    'hotcodepush usage list --month 2026-09',
    'hotcodepush usage list --organization Acme --limit 10 --offset 10 --json',
  ],
  options: defineCommandOptions({ ...monthOptionShape, ...paginationShape }),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedApps = await hotCodePush.organizations.usage.listApps({
      limit: options.limit,
      month: options.month,
      offset: options.offset,
      organizationId: await fetchOrganizationId(hotCodePush, options),
      relations: ['app'],
    });
    const nextOffset = resolveNextOffset(listedApps.length, options);
    if (options.json) {
      printJson({ apps: listedApps, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No app had monthly active devices in the month.',
      headers: ['APP', 'MAU', 'DATA TRANSFER'],
      nextOffset,
      rows: listedApps.map(({ app, appId, bytes, mau }) => [
        app?.name ?? appId,
        String(mau),
        resolveByteText(bytes),
      ]),
    });
  },
});
