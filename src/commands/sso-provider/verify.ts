import type { SsoProvider } from '@hotcodepush/node';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { resolveProviderDetails } from '../../resources/sso-providers.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printNotice } from '../../utils/diagnostics.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';

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
    printResult({
      rows: resolveProviderDetails(checkedProvider),
      sentence: resolveVerificationText(checkedProvider),
    });
    if (!checkedProvider.domainVerified) {
      printNotice('A new record can take a while to appear.');
    }
  },
});

function resolveVerificationText({
  domain,
  domainVerified,
}: SsoProvider): string {
  return domainVerified
    ? `Verified ${domain}.`
    : `No TXT record verifies ${domain} yet.`;
}
