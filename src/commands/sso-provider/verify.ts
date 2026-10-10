import type { SsoProviderVerification } from '@hotcodepush/node';
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
    const createdVerification =
      await hotCodePush.organizations.ssoProvider.verifications.create({
        organizationId: await fetchOrganizationId(hotCodePush, options),
      });
    if (options.json) {
      printJson(createdVerification);
      return;
    }
    console.log(resolveVerificationText(createdVerification));
    printProviderDetails(createdVerification);
  },
});

function resolveVerificationText({
  details,
  domain,
  isVerified,
}: SsoProviderVerification): string {
  if (isVerified) {
    return `Verified ${domain}.`;
  }
  if (details?.reason === 'lookup_failed') {
    return `The DNS lookup for ${domain} could not be made; run the command again in a moment.`;
  }
  return `No TXT record verifies ${domain} yet; a new record can take a while to appear.`;
}
