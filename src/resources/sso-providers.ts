import type { SsoProvider } from '@hotcodepush/node';
import { resolveConsoleBaseUrl } from '../utils/hosts.js';
import type { Detail } from '../utils/output.js';
import { resolveYesNoText } from '../utils/output.js';
import { readApiUrl } from '../utils/user-config.js';

export type SsoProviderType = SsoProvider['type'];

export function resolveProviderDetails(provider: SsoProvider): Detail[] {
  const apiUrl = readApiUrl();
  return [
    ['ID', provider.id],
    ['Type', provider.type],
    ['Domain', provider.domain],
    ['Verified', resolveYesNoText(provider.domainVerified)],
    [
      'Sign-in URL',
      `${resolveConsoleBaseUrl(apiUrl)}/login?sso=${provider.providerId}`,
    ],
    ...resolveServiceProviderDetails(provider, apiUrl),
    ...resolveVerificationDetails(provider),
  ];
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
