import { describe, expect, it } from 'vitest';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  SSO_PROVIDER,
  VERIFIED_SAML_SSO_PROVIDER,
} from '../../../test/fixtures.js';
import ssoProviderVerifyCommand from './verify.js';

const VERIFICATIONS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/sso-provider/verifications`;

describe('sso-provider verify', () => {
  const harness = useCommandHarness();

  function respondWithCheckedProvider(provider: object): void {
    harness.routes[`POST ${VERIFICATIONS_PATH}`] = () =>
      Response.json(provider);
  }

  it('should run the TXT-record check and print the verified provider', async () => {
    respondWithCheckedProvider(VERIFIED_SAML_SSO_PROVIDER);

    await ssoProviderVerifyCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.requests.map(({ method, url }) => [method, url])).toEqual([
      ['POST', `https://api.example.com${VERIFICATIONS_PATH}`],
    ]);
    expect(harness.readLines().slice(0, 5)).toEqual([
      'Verified example.com.',
      `ID               ${SSO_PROVIDER.id}`,
      'Type             saml',
      'Domain           example.com',
      'Verified         yes',
    ]);
  });

  it('should print the TXT record to set when the record is not found yet', async () => {
    respondWithCheckedProvider(SSO_PROVIDER);

    await ssoProviderVerifyCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    const printedLines = harness.readLines();
    expect(printedLines[0]).toBe(
      'No TXT record verifies example.com yet; a new record can take a while to appear.',
    );
    expect(printedLines.slice(-2)).toEqual([
      `TXT name      _hotcodepush-sso-${ACME_ORGANIZATION.id}.example.com`,
      'TXT value     b7Kq2vX9mN4pR8sT1wY6zA3c',
    ]);
  });

  it("should pass the API's `dns_lookup_failed` error through when the lookup could not run", async () => {
    harness.routes[`POST ${VERIFICATIONS_PATH}`] = () =>
      respondWithApiError(
        502,
        'dns_lookup_failed',
        'The DNS lookup could not be made; try again in a moment.',
      );

    await expect(
      ssoProviderVerifyCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'dns_lookup_failed', status: 502 });
    expect(harness.readLines()).toEqual([]);
  });

  it("should print the provider's row the API answers when --json is passed", async () => {
    respondWithCheckedProvider(SSO_PROVIDER);

    await ssoProviderVerifyCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(SSO_PROVIDER);
  });
});
