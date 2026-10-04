import { generateSigningKeyPair } from '@hotcodepush/protocol';
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

export default defineCommand({
  description:
    'Generate an RSA signing key pair on this machine and register its public key: from then on the app releases only signed bundles.',
  examples: [
    'hotcodepush signing-key create',
    'hotcodepush signing-key create --app "My App" --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(
      hotCodePush,
      options,
      projectConfigLocation.projectConfig,
    );
    const { privateKey, publicKey } = await generateSigningKeyPair();
    // Stored before the public half is registered: a registered key whose private half was lost could sign nothing
    const signingKeyFilePath = process.env.CI
      ? undefined
      : writeSigningPrivateKeys(appId, [privateKey]);
    const createdSigningKey = await hotCodePush.apps.signingKeys.create({
      appId,
      publicKey,
    });
    const isConfigured = addPublicKeyToProjectConfig(
      projectConfigLocation,
      appId,
      publicKey,
    );
    if (options.json) {
      printJson({ ...createdSigningKey, privateKey });
      return;
    }
    console.log(
      `Created signing key ${createdSigningKey.fingerprint} (${createdSigningKey.id}).`,
    );
    console.log(
      isConfigured
        ? `Added to publicKeys in ${PROJECT_CONFIG_FILE_NAME}.`
        : `Add it to publicKeys in the app's ${PROJECT_CONFIG_FILE_NAME}: ${publicKey}`,
    );
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
 * The public key appended to the `publicKeys` of the `hotcodepush.json` that names the app, after the keys it lists,
 * so the key that signs today keeps signing; a file of another app, or none, is left alone and answers false.
 */
function addPublicKeyToProjectConfig(
  { filePath, projectConfig }: ProjectConfigLocation,
  appId: string,
  publicKey: string,
): boolean {
  if (filePath === undefined || projectConfig?.appId !== appId) {
    return false;
  }
  writeProjectConfig(filePath, {
    ...projectConfig,
    publicKeys: [...(projectConfig.publicKeys ?? []), publicKey],
  });
  return true;
}
