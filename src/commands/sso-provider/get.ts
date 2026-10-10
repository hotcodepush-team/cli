import type { SsoProvider } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

type Detail = [label: string, value: string];

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

/**
 * The provider as `get` prints it: what it is, whether its domain is verified, the URLs the identity provider is given,
 * and the TXT record to set while the domain is not.
 */
export function printProviderDetails(provider: SsoProvider): void {
  printDetails([
    ['ID', provider.id],
    ['Provider', provider.provider],
    ['Domain', provider.domain],
    ['Verified', provider.isVerified ? 'yes' : 'no'],
    ['Sign-in URL', provider.signInUrl],
    ...resolveServiceProviderDetails(provider),
    ...resolveVerificationDetails(provider),
  ]);
}

/**
 * The URLs of ours the identity provider is configured with.
 */
function resolveServiceProviderDetails({ oidc, saml }: SsoProvider): Detail[] {
  if (oidc !== null) {
    return [['Redirect URI', oidc.redirectUri]];
  }
  if (saml !== null) {
    return [
      ['ACS URL', saml.acsUrl],
      ['SP metadata URL', saml.spMetadataUrl],
    ];
  }
  return [];
}

function resolveVerificationDetails({ verification }: SsoProvider): Detail[] {
  return verification === null
    ? []
    : [
        ['TXT name', verification.name],
        ['TXT value', verification.value],
      ];
}
