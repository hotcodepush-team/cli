import type { SsoProvider } from '@hotcodepush/node';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { resolveProviderDetails } from '../../resources/sso-providers.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printNotice, printWarning } from '../../utils/diagnostics.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson, printResult } from '../../utils/output.js';

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
    printVerification(checkedProvider);
  },
});

function printVerification(provider: SsoProvider): void {
  const rows = resolveProviderDetails(provider);
  if (provider.domainVerified) {
    printResult({ rows, sentence: `Verified ${provider.domain}.` });
    return;
  }
  printDetails(rows);
  printWarning(`No TXT record verifies ${provider.domain} yet.`);
  printNotice('A new record can take a while to appear.');
}
