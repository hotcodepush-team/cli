import { fetchOrganizationId } from '../../resources/organizations.js';
import { printProviderDetails } from '../../resources/sso-providers.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';

export default defineCommand({
  description:
    "Print the organization's SSO provider with its sign-in link and, until the domain is verified, the TXT record to set.",
  examples: [
    'hotcodepush sso-provider get',
    'hotcodepush sso-provider get --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedProvider = await hotCodePush.organizations.ssoProvider.get({
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    if (options.json) {
      printJson(fetchedProvider);
      return;
    }
    printProviderDetails(fetchedProvider);
  },
});
