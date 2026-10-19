import type { Organization } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import { resolveDollarText } from '../../utils/spending-cap.js';

export default defineCommand({
  description: 'Print an organization with its plan, spending cap and region.',
  examples: [
    'hotcodepush organization get --organization Acme',
    'hotcodepush organization get --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedOrganization = await hotCodePush.organizations.get({
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    if (options.json) {
      printJson(fetchedOrganization);
      return;
    }
    printOrganizationDetails(fetchedOrganization);
  },
});

export function printOrganizationDetails(organization: Organization): void {
  printDetails([
    ['ID', organization.id],
    ['Name', organization.name],
    ['Plan', organization.plan],
    [
      'Spending cap',
      `${resolveDollarText(organization.spendingCapCents)} a month`,
    ],
    ['Region', organization.region],
    ['Created', organization.createdAt],
  ]);
}
