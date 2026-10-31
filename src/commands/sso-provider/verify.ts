import type { SsoProvider } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import { printProviderDetails } from './get.js';

export default defineCommand({
  description:
    "Look up the domain's TXT record and mark the domain verified when it is there.",
  examples: [
    'hotcodepush sso-provider verify',
    'hotcodepush sso-provider verify --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const checkedProvider =
      await hotCodePush.organizations.ssoProvider.verifications.create({
        organizationId: await fetchOrganizationId(hotCodePush, options),
      });
    if (options.json) {
      printJson(checkedProvider);
      return;
    }
    console.log(resolveVerificationText(checkedProvider));
    printProviderDetails(checkedProvider);
  },
});

function resolveVerificationText({
  domain,
  domainVerified,
}: SsoProvider): string {
  return domainVerified
    ? `Verified ${domain}.`
    : `No TXT record verifies ${domain} yet; a new record can take a while to appear.`;
}
