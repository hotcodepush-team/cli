import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  SSO_PROVIDER,
  VERIFIED_SAML_SSO_PROVIDER,
} from '../../../test/fixtures.js';
import ssoProviderGetCommand from './get.js';

const SSO_PROVIDER_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/sso-provider`;

describe('sso-provider get', () => {
  const harness = useCommandHarness();

  it('should print the provider with its redirect URI and the TXT record to set while the domain is unverified', async () => {
    harness.routes[`GET ${SSO_PROVIDER_PATH}`] = () =>
      Response.json(SSO_PROVIDER);

    await ssoProviderGetCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID            ${SSO_PROVIDER.id}`,
      'Provider      oidc',
      'Domain        example.com',
      'Verified      no',
      `Sign-in URL   https://console.example.com/login?sso=${ACME_ORGANIZATION.id}`,
      `Redirect URI  https://api.example.com/v1/auth/sso/callback/${ACME_ORGANIZATION.id}`,
      `TXT name      _hotcodepush-sso-${ACME_ORGANIZATION.id}.example.com`,
      'TXT value     b7Kq2vX9mN4pR8sT1wY6zA3c',
    ]);
  });

  it('should print a verified SAML provider with its service provider URLs and no TXT record', async () => {
    harness.routes[`GET ${SSO_PROVIDER_PATH}`] = () =>
      Response.json(VERIFIED_SAML_SSO_PROVIDER);

    await ssoProviderGetCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID               ${SSO_PROVIDER.id}`,
      'Provider         saml',
      'Domain           example.com',
      'Verified         yes',
      `Sign-in URL      https://console.example.com/login?sso=${ACME_ORGANIZATION.id}`,
      `ACS URL          https://api.example.com/v1/auth/sso/saml2/sp/acs/${ACME_ORGANIZATION.id}`,
      `SP metadata URL  https://api.example.com/v1/auth/sso/saml2/sp/metadata?providerId=${ACME_ORGANIZATION.id}`,
    ]);
  });

  it('should print the provider as the API answers it when --json is passed', async () => {
    harness.routes[`GET ${SSO_PROVIDER_PATH}`] = () =>
      Response.json(SSO_PROVIDER);

    await ssoProviderGetCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(SSO_PROVIDER);
  });
});
