import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description: 'Print an organization with its plan and region.',
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
    printDetails([
      ['ID', fetchedOrganization.id],
      ['Name', fetchedOrganization.name],
      ['Plan', fetchedOrganization.plan],
      ['Region', fetchedOrganization.region],
      ['Created', fetchedOrganization.createdAt],
    ]);
  },
});
