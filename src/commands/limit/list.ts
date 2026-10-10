import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List the limits in effect for an organization: each value, the plan's default and whether it is overridden.",
  examples: [
    'hotcodepush limit list',
    'hotcodepush limit list --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedLimits = await hotCodePush.organizations.limits.get({
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    if (options.json) {
      printJson(fetchedLimits);
      return;
    }
    printTable({
      emptyText: 'No limits.',
      headers: ['LIMIT', 'VALUE', 'DEFAULT', 'OVERRIDDEN'],
      nextOffset: null,
      rows: Object.entries(fetchedLimits).map(([key, limit]) => [
        key,
        String(limit.value),
        String(limit.default),
        limit.isOverridden ? 'yes' : 'no',
      ]),
    });
  },
});
