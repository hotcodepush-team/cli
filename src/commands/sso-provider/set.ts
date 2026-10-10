import { readFileSync } from 'node:fs';
import type { PutSsoProviderOptions, SsoProvider } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { promptSecret, promptSelect, promptText } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import { printProviderDetails } from './get.js';

interface OidcOptions extends InteractivityOptions {
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcDiscoveryEndpoint?: string;
  oidcIssuer?: string;
  oidcScopes?: string[];
}

type ProviderKind = SsoProvider['provider'];

interface SamlOptions extends InteractivityOptions {
  samlCertPath?: string;
  samlEntityId?: string;
  samlEntryPoint?: string;
  samlIssuer?: string;
  samlMetadataPath?: string;
}

// a missing protocol names the first flag each protocol asks for
const PROVIDER_KIND_FLAG = '--oidc-issuer or --saml-entry-point';

export default defineCommand({
  description:
    "Set the organization's OIDC or SAML provider and its email domain, replacing the one before; a new domain starts unverified.",
  examples: [
    'hotcodepush sso-provider set --domain example.com --oidc-issuer https://login.example.com --oidc-client-id hotcodepush --oidc-client-secret "$OIDC_CLIENT_SECRET"',
    'hotcodepush sso-provider set --domain example.com --saml-entry-point https://idp.example.com/sso --saml-issuer https://idp.example.com --saml-metadata-path idp-metadata.xml --json',
  ],
  options: defineCommandOptions({
    domain: z
      .string()
      .optional()
      .describe(
        'The email domain whose addresses sign in through the provider, such as example.com.',
      ),
    oidcClientId: z
      .string()
      .optional()
      .describe('OIDC: the client ID the identity provider issued.'),
    oidcClientSecret: z
      .string()
      .optional()
      .describe('OIDC: the client secret the identity provider issued.'),
    oidcDiscoveryEndpoint: z
      .string()
      .optional()
      .describe(
        "OIDC: the discovery document's URL, the issuer's /.well-known/openid-configuration by default.",
      ),
    oidcIssuer: z
      .string()
      .optional()
      .describe("OIDC: the identity provider's issuer URL."),
    oidcScopes: z
      .string()
      .transform(value => value.split(',').map(scope => scope.trim()))
      .optional()
      .describe('OIDC: the scopes to request, comma-separated.'),
    samlCertPath: z
      .string()
      .optional()
      .describe(
        "SAML: the identity provider's signing certificate file, sent with --saml-entity-id when no metadata is.",
      ),
    samlEntityId: z
      .string()
      .optional()
      .describe("SAML: the identity provider's entity ID."),
    samlEntryPoint: z
      .string()
      .optional()
      .describe("SAML: the identity provider's sign-in URL."),
    samlIssuer: z
      .string()
      .optional()
      .describe("SAML: the identity provider's issuer."),
    samlMetadataPath: z
      .string()
      .optional()
      .describe("SAML: the identity provider's metadata XML file."),
  }),
  action: async options => {
    const flaggedProviderKind = resolveFlaggedProviderKind(options);
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const domain =
      options.domain ??
      (await promptText(
        '--domain',
        'Which email domain signs in through the provider?',
        options,
      ));
    const providerKind =
      flaggedProviderKind ??
      (await promptSelect<ProviderKind>(
        PROVIDER_KIND_FLAG,
        'Which protocol does the identity provider speak?',
        [
          { label: 'OIDC', value: 'oidc' },
          { label: 'SAML', value: 'saml' },
        ],
        options,
      ));
    const updatedProvider = await hotCodePush.organizations.ssoProvider.put({
      domain,
      organizationId,
      ...(providerKind === 'oidc'
        ? { oidc: await promptOidcBlock(options) }
        : { saml: await promptSamlBlock(options) }),
    });
    if (options.json) {
      printJson(updatedProvider);
      return;
    }
    console.log(
      `Set the ${updatedProvider.provider} provider for ${updatedProvider.domain}.`,
    );
    printProviderDetails(updatedProvider);
  },
});

/**
 * The OIDC block from its flags, asking for each required one the command line left out; the secret is asked for unseen.
 */
async function promptOidcBlock(
  options: OidcOptions,
): Promise<NonNullable<PutSsoProviderOptions['oidc']>> {
  const issuer =
    options.oidcIssuer ??
    (await promptText(
      '--oidc-issuer',
      "What is the identity provider's issuer URL?",
      options,
    ));
  const clientId =
    options.oidcClientId ??
    (await promptText('--oidc-client-id', 'What is the client ID?', options));
  const clientSecret =
    options.oidcClientSecret ??
    (await promptSecret(
      '--oidc-client-secret',
      'What is the client secret?',
      options,
    ));
  return {
    clientId,
    clientSecret,
    discoveryEndpoint: options.oidcDiscoveryEndpoint,
    issuer,
    scopes: options.oidcScopes,
  };
}

/**
 * The SAML block from its flags, asking for each required one the command line left out, the metadata and the certificate
 * as their files' text, never parsed: the API reads them. Without a certificate or an entity id, the metadata file is required.
 */
async function promptSamlBlock(
  options: SamlOptions,
): Promise<NonNullable<PutSsoProviderOptions['saml']>> {
  const entryPoint =
    options.samlEntryPoint ??
    (await promptText(
      '--saml-entry-point',
      "What is the identity provider's sign-in URL?",
      options,
    ));
  const issuer =
    options.samlIssuer ??
    (await promptText(
      '--saml-issuer',
      "What is the identity provider's issuer?",
      options,
    ));
  const hasCertificateOrEntityId =
    options.samlCertPath !== undefined || options.samlEntityId !== undefined;
  const metadataPath =
    options.samlMetadataPath ??
    (hasCertificateOrEntityId
      ? undefined
      : await promptText(
          '--saml-metadata-path',
          "Which file holds the identity provider's SAML metadata?",
          options,
        ));
  return {
    cert:
      options.samlCertPath === undefined
        ? undefined
        : readDocumentFile('--saml-cert-path', options.samlCertPath),
    entityId: options.samlEntityId,
    entryPoint,
    issuer,
    metadata:
      metadataPath === undefined
        ? undefined
        : readDocumentFile('--saml-metadata-path', metadataPath),
  };
}

function readDocumentFile(flag: string, filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new InvalidParameterError(
      `${flag}: cannot read ${filePath}`,
      error,
      'pass the path of a file you can read.',
    );
  }
}

/**
 * The protocol the flags name, OIDC by an --oidc- flag and SAML by a --saml- one, or none when neither appears;
 * a provider speaks one protocol, so both are refused.
 */
function resolveFlaggedProviderKind(
  options: OidcOptions & SamlOptions,
): ProviderKind | undefined {
  const hasOidcFlag = [
    options.oidcClientId,
    options.oidcClientSecret,
    options.oidcDiscoveryEndpoint,
    options.oidcIssuer,
    options.oidcScopes,
  ].some(value => value !== undefined);
  const hasSamlFlag = [
    options.samlCertPath,
    options.samlEntityId,
    options.samlEntryPoint,
    options.samlIssuer,
    options.samlMetadataPath,
  ].some(value => value !== undefined);
  if (hasOidcFlag && hasSamlFlag) {
    throw new InvalidParameterError(
      'the --oidc- and --saml- flags were passed together',
      undefined,
      'pass the --oidc- flags for an OIDC provider or the --saml- flags for a SAML one, since a provider speaks one protocol.',
    );
  }
  if (hasOidcFlag) {
    return 'oidc';
  }
  return hasSamlFlag ? 'saml' : undefined;
}
