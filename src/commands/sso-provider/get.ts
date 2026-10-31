import type { SsoProvider } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveConsoleBaseUrl } from '../../utils/hosts.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import { readApiUrl } from '../../utils/user-config.js';

type Detail = [label: string, value: string];

export type SsoProviderType = SsoProvider['type'];

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

export function printProviderDetails(provider: SsoProvider): void {
  const apiUrl = readApiUrl();
  printDetails([
    ['ID', provider.id],
    ['Type', provider.type],
    ['Domain', provider.domain],
    ['Verified', provider.domainVerified ? 'yes' : 'no'],
    [
      'Sign-in URL',
      `${resolveConsoleBaseUrl(apiUrl)}/login?sso=${provider.providerId}`,
    ],
    ...resolveServiceProviderDetails(provider, apiUrl),
    ...resolveVerificationDetails(provider),
  ]);
}

// The identity provider calls these URLs on the API origin.
function resolveServiceProviderDetails(
  { providerId, type }: SsoProvider,
  apiUrl: string,
): Detail[] {
  const ssoUrl = `${apiUrl}/v1/auth/sso`;
  return type === 'oidc'
    ? [['Redirect URI', `${ssoUrl}/callback/${providerId}`]]
    : [
        ['ACS URL', `${ssoUrl}/saml2/sp/acs/${providerId}`],
        [
          'SP metadata URL',
          `${ssoUrl}/saml2/sp/metadata?providerId=${providerId}`,
        ],
      ];
}

// The record name is the provider name under the domain.
function resolveVerificationDetails({
  domain,
  domainVerificationToken,
  domainVerified,
  providerId,
}: SsoProvider): Detail[] {
  return domainVerified || domainVerificationToken === null
    ? []
    : [
        ['TXT name', `_hotcodepush-sso-${providerId}.${domain}`],
        ['TXT value', domainVerificationToken],
      ];
}
