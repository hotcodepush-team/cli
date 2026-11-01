import {
  fetchOrganizationId,
  printOrganizationDetails,
} from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';

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
