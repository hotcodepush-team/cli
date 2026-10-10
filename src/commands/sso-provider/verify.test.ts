import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  SSO_PROVIDER,
  VERIFIED_SAML_SSO_PROVIDER,
} from '../../../test/fixtures.js';
import ssoProviderVerifyCommand from './verify.js';

const VERIFICATIONS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/sso-provider/verifications`;

describe('sso-provider verify', () => {
  const harness = useCommandHarness();

  function respondWithVerification(verification: object): void {
    harness.routes[`POST ${VERIFICATIONS_PATH}`] = () =>
      Response.json(verification);
  }

  it('should run the TXT-record check and print the verified provider', async () => {
    respondWithVerification({ ...VERIFIED_SAML_SSO_PROVIDER, details: null });

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
      'Provider         saml',
      'Domain           example.com',
      'Verified         yes',
    ]);
  });

  it('should print the TXT record to set when the record is not found yet', async () => {
    respondWithVerification({ ...SSO_PROVIDER, details: null });

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

  it('should say the lookup could not be made when the resolver could not be asked', async () => {
    respondWithVerification({
      ...SSO_PROVIDER,
      details: { reason: 'lookup_failed' },
    });

    await ssoProviderVerifyCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()[0]).toBe(
      'The DNS lookup for example.com could not be made; run the command again in a moment.',
    );
  });

  it("should print the API's answer when --json is passed", async () => {
    const verification = { ...SSO_PROVIDER, details: null };
    respondWithVerification(verification);

    await ssoProviderVerifyCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(verification);
  });
});
