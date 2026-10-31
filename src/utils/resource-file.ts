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

export interface EmbeddedBundle {
  bundleVersion: string;
  files: BundleFile[];
  id: string | null;
}

interface ResourceFileInput {
  builtAt: string;
  // Null when the channel name was not resolved, the build is offline or it bundled nothing.
  channelId: string | null;
  // Null for a build that bundled no JavaScript, which takes no OTA updates.
  embeddedBundle: EmbeddedBundle | null;
  fingerprint: string;
  hosts: DeviceHosts;
  platform: Platform;
  projectConfig: ProjectConfig;
}

// The manifest is the unsigned bundle manifest without patches, whether or not a binary was created.
// The public keys take the form that the platform API imports.
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
    ...omitProjectOnlyKeys(projectConfig),
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

// The device imports the DER with its platform API and handles no ASN.1 itself.
// iOS `SecKeyCreateWithData` takes PKCS #1 and Android `X509EncodedKeySpec` takes SPKI.
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
    `The publicKeys in ${PROJECT_CONFIG_FILE_NAME} list ${publicKey.slice(0, 32)}…, which is not an rsa-v1_5-sha256 key of ${SIGNING_KEY_BITS_MINIMUM} bits or more.`,
    'Replace it with the public key "hotcodepush signing-key create" writes.',
    cause,
  );
}

// The resolved id replaces the channel, and only the CLI reads the fingerprint paths.
function omitProjectOnlyKeys(projectConfig: ProjectConfig): ProjectConfig {
  const configuration = { ...projectConfig };
  delete configuration.channel;
  delete configuration.extraFingerprintPaths;
  return configuration;
}
