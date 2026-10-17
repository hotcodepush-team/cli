import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { resolveByteText } from '../../utils/progress.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import { monthOptionShape, resolveMonthText } from '../../utils/usage-month.js';

export default defineCommand({
  description:
    "Print an organization's monthly active devices and data transfer in a month, the totals the invoice counts.",
  examples: [
    'hotcodepush usage get',
    'hotcodepush usage get --organization Acme --month 2026-09 --json',
  ],
  options: defineCommandOptions(monthOptionShape),
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
    printDetails([
      ['Month', resolveMonthText(fetchedUsage.month)],
      ['MAU', String(fetchedUsage.monthlyActiveDeviceCount)],
      ['Data transfer', resolveByteText(fetchedUsage.dataTransferBytes)],
    ]);
  },
});
