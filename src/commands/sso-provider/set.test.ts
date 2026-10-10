import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { password, select, text } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  SSO_PROVIDER,
  VERIFIED_SAML_SSO_PROVIDER,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import {
  InvalidParameterError,
  MissingParameterError,
} from '../../utils/errors.js';
import ssoProviderSetCommand from './set.js';

vi.mock('@clack/prompts');

const SSO_PROVIDER_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/sso-provider`;

const METADATA_XML =
  '<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com"></EntityDescriptor>\n';

const CERTIFICATE_PEM =
  '-----BEGIN CERTIFICATE-----\nMIIBfakecertificate\n-----END CERTIFICATE-----\n';

const OIDC_FLAGS = {
  oidcClientId: 'hotcodepush',
  oidcClientSecret: 'client-secret-1',
  oidcIssuer: 'https://login.example.com',
};

const SAML_FLAGS = {
  samlEntryPoint: 'https://idp.example.com/sso',
  samlIssuer: 'https://idp.example.com',
};

describe('sso-provider set', () => {
  const harness = useCommandHarness();
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  async function readPutBody(): Promise<unknown> {
    return harness.requests.find(({ method }) => method === 'PUT')?.json();
  }

  function respondWithProvider(provider: object): void {
    harness.routes[`PUT ${SSO_PROVIDER_PATH}`] = () => Response.json(provider);
  }

  function writeDocumentFile(fileName: string, content: string): string {
    const filePath = join(directoryPath, fileName);
    writeFileSync(filePath, content);
    return filePath;
  }

  it('should set an OIDC provider from its flags and print it with what the identity provider and the DNS need', async () => {
    respondWithProvider(SSO_PROVIDER);

    await ssoProviderSetCommand.action(
      {
        ...OIDC_FLAGS,
        domain: 'example.com',
        oidcDiscoveryEndpoint:
          'https://login.example.com/.well-known/openid-configuration',
        oidcScopes: ['openid', 'email'],
        organization: ACME_ORGANIZATION.id,
      },
      undefined,
    );

    expect(await readPutBody()).toEqual({
      domain: 'example.com',
      oidc: {
        clientId: 'hotcodepush',
        clientSecret: 'client-secret-1',
        discoveryEndpoint:
          'https://login.example.com/.well-known/openid-configuration',
        issuer: 'https://login.example.com',
        scopes: ['openid', 'email'],
      },
    });
    expect(harness.readLines()).toEqual([
      'Set the oidc provider for example.com.',
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

  it("should send the SAML metadata file's text as read and print the provider as JSON when --json is passed", async () => {
    respondWithProvider(VERIFIED_SAML_SSO_PROVIDER);

    await ssoProviderSetCommand.action(
      {
        ...SAML_FLAGS,
        domain: 'example.com',
        json: true,
        organization: ACME_ORGANIZATION.id,
        samlMetadataPath: writeDocumentFile('idp-metadata.xml', METADATA_XML),
      },
      undefined,
    );

    expect(await readPutBody()).toEqual({
      domain: 'example.com',
      saml: {
        entryPoint: SAML_FLAGS.samlEntryPoint,
        issuer: SAML_FLAGS.samlIssuer,
        metadata: METADATA_XML,
      },
    });
    expect(harness.readJson()).toEqual(VERIFIED_SAML_SSO_PROVIDER);
  });

  it("should send the certificate file's text with the entity id when no metadata file is passed", async () => {
    respondWithProvider(VERIFIED_SAML_SSO_PROVIDER);

    await ssoProviderSetCommand.action(
      {
        ...SAML_FLAGS,
        domain: 'example.com',
        organization: ACME_ORGANIZATION.id,
        samlCertPath: writeDocumentFile('idp-certificate.pem', CERTIFICATE_PEM),
        samlEntityId: 'https://idp.example.com',
      },
      undefined,
    );

    expect(await readPutBody()).toEqual({
      domain: 'example.com',
      saml: {
        cert: CERTIFICATE_PEM,
        entityId: 'https://idp.example.com',
        entryPoint: SAML_FLAGS.samlEntryPoint,
        issuer: SAML_FLAGS.samlIssuer,
      },
    });
  });

  it('should read --oidc-scopes from the command line as the scopes it separates by commas', async () => {
    respondWithProvider(SSO_PROVIDER);

    await runCli(
      { 'sso-provider set': () => import('./set.js') },
      [
        'sso-provider',
        'set',
        '--organization',
        ACME_ORGANIZATION.id,
        '--domain',
        'example.com',
        '--oidc-issuer',
        OIDC_FLAGS.oidcIssuer,
        '--oidc-client-id',
        OIDC_FLAGS.oidcClientId,
        '--oidc-client-secret',
        OIDC_FLAGS.oidcClientSecret,
        '--oidc-scopes',
        'openid, email,profile',
      ],
      PACKAGE_JSON,
    );

    expect(await readPutBody()).toEqual({
      domain: 'example.com',
      oidc: {
        clientId: 'hotcodepush',
        clientSecret: 'client-secret-1',
        issuer: 'https://login.example.com',
        scopes: ['openid', 'email', 'profile'],
      },
    });
  });

  it('should ask for the domain, the protocol and the OIDC fields when interactive, the secret unseen', async () => {
    stubInteractiveTerminal();
    vi.mocked(text)
      .mockResolvedValueOnce('example.com')
      .mockResolvedValueOnce('https://login.example.com')
      .mockResolvedValueOnce('hotcodepush');
    vi.mocked(select).mockResolvedValue('oidc');
    vi.mocked(password).mockResolvedValue('client-secret-1');
    respondWithProvider(SSO_PROVIDER);

    await ssoProviderSetCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which protocol does the identity provider speak?',
      options: [
        { label: 'OIDC', value: 'oidc' },
        { label: 'SAML', value: 'saml' },
      ],
    });
    expect(password).toHaveBeenCalledWith({
      message: 'What is the client secret?',
      validate: expect.any(Function),
    });
    expect(await readPutBody()).toEqual({
      domain: 'example.com',
      oidc: {
        clientId: 'hotcodepush',
        clientSecret: 'client-secret-1',
        issuer: 'https://login.example.com',
      },
    });
  });

  it('should ask for the SAML metadata file when interactive and neither a certificate nor an entity id is passed', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue(
      writeDocumentFile('idp-metadata.xml', METADATA_XML),
    );
    respondWithProvider(VERIFIED_SAML_SSO_PROVIDER);

    await ssoProviderSetCommand.action(
      {
        ...SAML_FLAGS,
        domain: 'example.com',
        organization: ACME_ORGANIZATION.id,
      },
      undefined,
    );

    expect(text).toHaveBeenCalledWith({
      message: "Which file holds the identity provider's SAML metadata?",
      validate: expect.any(Function),
    });
    expect(await readPutBody()).toEqual({
      domain: 'example.com',
      saml: {
        entryPoint: SAML_FLAGS.samlEntryPoint,
        issuer: SAML_FLAGS.samlIssuer,
        metadata: METADATA_XML,
      },
    });
  });

  it('should throw E_MISSING_PARAMETER naming --domain when it is missing and nobody can be asked', async () => {
    await expect(
      ssoProviderSetCommand.action(
        { ...OIDC_FLAGS, organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--domain'));
    expect(harness.requests).toEqual([]);
  });

  it('should throw E_MISSING_PARAMETER naming either protocol when no protocol flag is passed and nobody can be asked', async () => {
    await expect(
      ssoProviderSetCommand.action(
        { domain: 'example.com', organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(
      new MissingParameterError('--oidc-issuer or --saml-entry-point'),
    );
  });

  it('should throw E_MISSING_PARAMETER naming --oidc-client-secret when it is missing and nobody can be asked', async () => {
    await expect(
      ssoProviderSetCommand.action(
        {
          ...OIDC_FLAGS,
          domain: 'example.com',
          oidcClientSecret: undefined,
          organization: ACME_ORGANIZATION.id,
        },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--oidc-client-secret'));
    expect(harness.requests).toEqual([]);
  });

  it('should throw E_MISSING_PARAMETER naming --saml-metadata-path when no SAML document is passed and nobody can be asked', async () => {
    await expect(
      ssoProviderSetCommand.action(
        {
          ...SAML_FLAGS,
          domain: 'example.com',
          organization: ACME_ORGANIZATION.id,
        },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--saml-metadata-path'));
    expect(harness.requests).toEqual([]);
  });

  it('should throw E_INVALID_PARAMETER before any request when OIDC and SAML flags are passed together', async () => {
    await expect(
      ssoProviderSetCommand.action(
        {
          ...OIDC_FLAGS,
          ...SAML_FLAGS,
          domain: 'example.com',
          organization: 'Acme',
        },
        undefined,
      ),
    ).rejects.toThrow(InvalidParameterError);
    expect(harness.requests).toEqual([]);
  });

  it('should throw E_INVALID_PARAMETER naming the flag when the metadata file cannot be read', async () => {
    const missingFilePath = join(directoryPath, 'missing.xml');

    await expect(
      ssoProviderSetCommand.action(
        {
          ...SAML_FLAGS,
          domain: 'example.com',
          organization: ACME_ORGANIZATION.id,
          samlMetadataPath: missingFilePath,
        },
        undefined,
      ),
    ).rejects.toThrow(`--saml-metadata-path: cannot read ${missingFilePath}`);
    expect(harness.requests).toEqual([]);
  });
});
