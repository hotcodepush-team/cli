import { readFileSync } from 'node:fs';
import type { SetSsoProviderOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { resolveProviderDetails } from '../../resources/sso-providers.js';
import type { SsoProviderType } from '../../resources/sso-providers.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { promptSecret, promptSelect, promptText } from '../../utils/prompts.js';

interface OidcOptions extends InteractivityOptions {
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcDiscoveryEndpoint?: string;
  oidcIssuer?: string;
  oidcScopes?: string[];
}

interface SamlOptions extends InteractivityOptions {
  samlCertPath?: string;
  samlEntityId?: string;
  samlEntryPoint?: string;
  samlIssuer?: string;
  samlMetadataPath?: string;
}

// A missing protocol names the first flag of each protocol.
const PROVIDER_TYPE_FLAG = '--oidc-issuer or --saml-entry-point';

export default defineCommand({
  description:
    "Set the organization's OIDC or SAML provider and its email domain, replacing the one before. A new domain starts unverified.",
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
    const flaggedProviderType = resolveFlaggedProviderType(options);
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const domain =
      options.domain ??
      (await promptText(options, {
        flag: '--domain',
        message: 'Which email domain signs in through the provider?',
      }));
    const providerType =
      flaggedProviderType ??
      (await promptSelect<SsoProviderType>(options, {
        choices: [
          { label: 'OIDC', value: 'oidc' },
          { label: 'SAML', value: 'saml' },
        ],
        flag: PROVIDER_TYPE_FLAG,
        message: 'Which protocol does the identity provider speak?',
      }));
    const updatedProvider = await hotCodePush.organizations.ssoProvider.set({
      domain,
      organizationId,
      ...(providerType === 'oidc'
        ? { oidc: await promptOidcBlock(options) }
        : { saml: await promptSamlBlock(options) }),
    });
    if (options.json) {
      printJson(updatedProvider);
      return;
    }
    printResult({
      rows: resolveProviderDetails(updatedProvider),
      sentence: `Set the ${providerType} provider for ${updatedProvider.domain}.`,
    });
  },
});

async function promptOidcBlock(
  options: OidcOptions,
): Promise<NonNullable<SetSsoProviderOptions['oidc']>> {
  const issuer =
    options.oidcIssuer ??
    (await promptText(options, {
      flag: '--oidc-issuer',
      message: "What is the identity provider's issuer URL?",
    }));
  const clientId =
    options.oidcClientId ??
    (await promptText(options, {
      flag: '--oidc-client-id',
      message: 'What is the client ID?',
    }));
  const clientSecret =
    options.oidcClientSecret ??
    (await promptSecret(options, {
      flag: '--oidc-client-secret',
      message: 'What is the client secret?',
    }));
  return {
    clientId,
    clientSecret,
    discoveryEndpoint: options.oidcDiscoveryEndpoint,
    issuer,
    scopes: options.oidcScopes,
  };
}

// The metadata and the certificate are sent as text and never parsed, since the API reads them.
async function promptSamlBlock(
  options: SamlOptions,
): Promise<NonNullable<SetSsoProviderOptions['saml']>> {
  const entryPoint =
    options.samlEntryPoint ??
    (await promptText(options, {
      flag: '--saml-entry-point',
      message: "What is the identity provider's sign-in URL?",
    }));
  const issuer =
    options.samlIssuer ??
    (await promptText(options, {
      flag: '--saml-issuer',
      message: "What is the identity provider's issuer?",
    }));
  const hasCertificateOrEntityId =
    options.samlCertPath !== undefined || options.samlEntityId !== undefined;
  const metadataPath =
    options.samlMetadataPath ??
    (hasCertificateOrEntityId
      ? undefined
      : await promptText(options, {
          flag: '--saml-metadata-path',
          message: "Which file holds the identity provider's SAML metadata?",
        }));
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
      `The file ${filePath} from ${flag} cannot be read.`,
      { cause: error, fix: 'Pass the path of a file you can read.' },
    );
  }
}

// A provider speaks one protocol, so flags of both are refused.
function resolveFlaggedProviderType(
  options: OidcOptions & SamlOptions,
): SsoProviderType | undefined {
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
      'The --oidc- and --saml- flags were passed together.',
      {
        fix: 'Pass the --oidc- flags for an OIDC provider or the --saml- flags for a SAML one, since a provider speaks one protocol.',
      },
    );
  }
  if (hasOidcFlag) {
    return 'oidc';
  }
  return hasSamlFlag ? 'saml' : undefined;
}
