import { fetchOrganizationId } from '../../resources/organizations.js';
import { monthOptionShape } from '../../resources/usage.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveByteText } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';

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
    const listedApps = await hotCodePush.organizations.usage.apps.list({
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
      rows: listedApps.map(
        ({ app, appId, dataTransferBytes, monthlyActiveDeviceCount }) => [
          app?.name ?? appId,
          String(monthlyActiveDeviceCount),
          resolveByteText(dataTransferBytes),
        ],
      ),
    });
  },
});
