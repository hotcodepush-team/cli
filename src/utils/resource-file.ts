import { createPublicKey } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Configuration, DevicePublicKey } from '@hotcodepush/protocol';
import {
  ConfigurationSchema,
  resolveSigningKeyFingerprint,
  SIGNING_KEY_BITS_MINIMUM,
  SigningPublicKeySchema,
} from '@hotcodepush/protocol';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import type { BundleFile } from './bundle-files.js';
import { InvalidParameterError } from './errors.js';
import type { DeviceHosts } from './hosts.js';
import type { ProjectConfig } from './project-config.js';
import type { Platform } from './upload.js';

/**
 * The bundle a build embeds: its files, the version its manifest carries, and its id, null while no binary was created with it.
 */
export interface EmbeddedBundle {
  bundleVersion: string;
  files: BundleFile[];
  id: string | null;
}

interface ResourceFileInput {
  builtAt: string;
  /** Null for a build whose channel name was not resolved, made offline or bundling nothing. */
  channelId: string | null;
  /** Null for a build that bundled no JavaScript, which takes no updates. */
  embeddedBundle: EmbeddedBundle | null;
  fingerprint: string;
  hosts: DeviceHosts;
  platform: Platform;
  projectConfig: ProjectConfig;
}

/**
 * The resource file: the project's configuration with the channel as the id the build step resolved, null offline, plus what only
 * a build step can know — the floor, the fingerprint, the embedded bundle's manifest and id, both null without an embedded bundle,
 * and the device hosts outside production.
 * The manifest is the bundle manifest without patches, unsigned, the same whether the bundle was registered or not.
 * The public keys leave their project form for the one the platform's own API imports.
 */
export function buildResourceFile({
  builtAt,
  channelId,
  embeddedBundle,
  fingerprint,
  hosts,
  platform,
  projectConfig,
}: ResourceFileInput): Configuration {
  return ConfigurationSchema.parse({
    ...omitChannel(projectConfig),
    builtAt,
    channelId,
    embeddedBundleId: embeddedBundle?.id ?? null,
    embeddedBundleManifest:
      embeddedBundle === null
        ? null
        : {
            appId: projectConfig.appId,
            bundleVersion: embeddedBundle.bundleVersion,
            files: embeddedBundle.files.map(({ path, sha256, sizeBytes }) => ({
              path,
              sha256,
              sizeBytes,
            })),
            fingerprint,
            keyId: null,
            platforms: [platform],
          },
    fingerprint,
    publicKeys: (projectConfig.publicKeys ?? []).map(publicKey =>
      resolveDevicePublicKey(publicKey, platform),
    ),
    ...(hosts.filesBaseUrl === undefined
      ? {}
      : { filesBaseUrl: hosts.filesBaseUrl }),
    ...(hosts.updatesBaseUrl === undefined
      ? {}
      : { updatesBaseUrl: hosts.updatesBaseUrl }),
  });
}

export function writeResourceFile(
  filePath: string,
  configuration: Configuration,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(configuration, null, 2)}\n`);
}

/**
 * A public key of the project as the device reads it: the DER its platform's own API imports with no ASN.1 handled on the
 * device — PKCS #1 for iOS's `SecKeyCreateWithData`, SPKI for Android's `X509EncodedKeySpec` — beside the key id a signature
 * names. Node's key export does the conversion; a key that is no RSA key of the minimum size stops the build step.
 */
function resolveDevicePublicKey(
  publicKey: string,
  platform: Platform,
): DevicePublicKey {
  if (!SigningPublicKeySchema.safeParse(publicKey).success) {
    throw buildUnusablePublicKeyError(publicKey);
  }
  let keyObject;
  try {
    keyObject = createPublicKey({
      format: 'der',
      key: Buffer.from(publicKey.slice(publicKey.indexOf(':') + 1), 'base64'),
      type: 'spki',
    });
  } catch (error) {
    throw buildUnusablePublicKeyError(publicKey, error);
  }
  if (
    keyObject.asymmetricKeyType !== 'rsa' ||
    (keyObject.asymmetricKeyDetails?.modulusLength ?? 0) <
      SIGNING_KEY_BITS_MINIMUM
  ) {
    throw buildUnusablePublicKeyError(publicKey);
  }
  return {
    der: keyObject
      .export({ format: 'der', type: platform === 'ios' ? 'pkcs1' : 'spki' })
      .toString('base64'),
    keyId: resolveSigningKeyFingerprint(publicKey),
  };
}

function buildUnusablePublicKeyError(
  publicKey: string,
  cause?: unknown,
): InvalidParameterError {
  return new InvalidParameterError(
    `${PROJECT_CONFIG_FILE_NAME}: publicKeys lists ${publicKey.slice(0, 32)}…, which is no rsa-v1_5-sha256 key of ${SIGNING_KEY_BITS_MINIMUM} bits or more`,
    cause,
    'replace it with the public key "hotcodepush signing-key create" writes.',
  );
}

/**
 * The project's configuration without its channel, which the resolved id replaces.
 */
function omitChannel(projectConfig: ProjectConfig): ProjectConfig {
  const configuration = { ...projectConfig };
  delete configuration.channel;
  return configuration;
}
