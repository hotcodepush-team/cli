import { fetchOrganizationId } from '../../resources/organizations.js';
import { monthOptionShape, resolveMonthText } from '../../resources/usage.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printDetails,
  printJson,
  resolveByteText,
} from '../../utils/output.js';

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
