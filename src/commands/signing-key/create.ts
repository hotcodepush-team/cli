import type { SigningKey } from '@hotcodepush/node';
import { generateSigningKeyPair } from '@hotcodepush/protocol';
import type { SigningKeyPair, SigningScheme } from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { PROJECT_CONFIG_FILE_NAME } from '../../config/consts.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import type { ProjectConfigLocation } from '../../utils/project-config.js';
import {
  locateProjectConfig,
  writeProjectConfig,
} from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';
import { writeSigningPrivateKeys } from '../../utils/signing-key-store.js';

// The platform's scheme, and beside it the one Expo clients verify, which only an Expo-bridge app carries
const DEFAULT_SCHEMES: SigningScheme[] = ['ed25519'];
const EXPO_BRIDGE_SCHEMES: SigningScheme[] = ['ed25519', 'rsa-v1_5-sha256'];

export default defineCommand({
  description:
    'Generate a signing key pair on this machine and register its public key: from then on the app releases only signed bundles.',
  examples: [
    'hotcodepush signing-key create',
    'hotcodepush signing-key create --expo-bridge --json',
  ],
  options: defineCommandOptions({
    expoBridge: z
      .boolean()
      .optional()
      .describe(
        'Also generate the RSA pair the Expo Updates bridge signs its manifests with.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(
      hotCodePush,
      options,
      projectConfigLocation.projectConfig,
    );
    const keyPairs: SigningKeyPair[] = [];
    for (const scheme of options.expoBridge
      ? EXPO_BRIDGE_SCHEMES
      : DEFAULT_SCHEMES) {
      keyPairs.push(await generateSigningKeyPair(scheme));
    }
    const privateKeys = keyPairs.map(({ privateKey }) => privateKey);
    // Stored before the public half is registered: a registered key whose private half was lost could sign nothing
    const signingKeyFilePath = process.env.CI
      ? undefined
      : writeSigningPrivateKeys(appId, privateKeys);
    const createdSigningKeys: SigningKey[] = [];
    for (const { publicKey } of keyPairs) {
      createdSigningKeys.push(
        await hotCodePush.apps.signingKeys.create({ appId, publicKey }),
      );
    }
    const isConfigured = addPublicKeysToProjectConfig(
      projectConfigLocation,
      appId,
      keyPairs.map(({ publicKey }) => publicKey),
    );
    // One value for the CI secret, the keys separated by a comma
    const privateKey = privateKeys.join(',');
    if (options.json) {
      printJson({ privateKey, signingKeys: createdSigningKeys });
      return;
    }
    for (const { fingerprint, id, publicKey } of createdSigningKeys) {
      console.log(`Created signing key ${fingerprint} (${id}).`);
      if (!isConfigured) {
        console.log(
          `Add it to publicKeys in the app's ${PROJECT_CONFIG_FILE_NAME}: ${publicKey}`,
        );
      }
    }
    if (isConfigured) {
      console.log(`Added to publicKeys in ${PROJECT_CONFIG_FILE_NAME}.`);
    }
    console.log(
      'The private key, shown once; set it as HOTCODEPUSH_SIGNING_KEY in CI:',
    );
    console.log(privateKey);
    if (signingKeyFilePath !== undefined) {
      console.log(`Stored in ${signingKeyFilePath}.`);
    }
  },
});

/**
 * The public keys appended to the `publicKeys` of the `hotcodepush.json` that names the app, after the keys it lists,
 * so the key that signs today keeps signing; a file of another app, or none, is left alone and answers false.
 */
function addPublicKeysToProjectConfig(
  { filePath, projectConfig }: ProjectConfigLocation,
  appId: string,
  publicKeys: string[],
): boolean {
  if (filePath === undefined || projectConfig?.appId !== appId) {
    return false;
  }
  writeProjectConfig(filePath, {
    ...projectConfig,
    publicKeys: [...(projectConfig.publicKeys ?? []), ...publicKeys],
  });
  return true;
}
