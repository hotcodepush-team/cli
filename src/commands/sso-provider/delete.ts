import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "Delete the organization's SSO provider: password sign-in works again for its members, and the domain is forgotten.",
  examples: [
    'hotcodepush sso-provider delete',
    'hotcodepush sso-provider delete --organization Acme --yes --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const fetchedProvider = await hotCodePush.organizations.ssoProvider.get({
      organizationId,
    });
    const isConfirmed = await confirmConsequence(
      `deletes the SSO provider for ${fetchedProvider.domain}: password sign-in works again for its members and the domain is forgotten`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.organizations.ssoProvider.delete({ organizationId });
    if (options.json) {
      // every delete prints { id, name }, and a provider's name is its domain
      printJson({ id: fetchedProvider.id, name: fetchedProvider.domain });
    } else {
      console.log(
        `Deleted the SSO provider for ${fetchedProvider.domain} (${fetchedProvider.id}).`,
      );
    }
  },
});
