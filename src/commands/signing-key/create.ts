import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateSigningKeyPair } from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import {
  PROJECT_CONFIG_FILE_NAME,
  SIGNING_PRIVATE_KEY_FILE_NAME,
} from '../../config/consts.js';
import { createApiClient } from '../../utils/api-client.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import type { ProjectConfigLocation } from '../../utils/project-config.js';
import {
  locateProjectConfig,
  writeProjectConfig,
} from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';
import { writeSigningPrivateKeyFile } from '../../utils/signing-private-key.js';

export default defineCommand({
  description:
    'Generate an RSA signing key pair on this machine, write the private key to a new file and register the public key: from then on the app releases only signed bundles.',
  examples: [
    'hotcodepush signing-key create',
    'hotcodepush signing-key create --app "My App" --private-key-path my-app-private-key.pem --json',
  ],
  options: defineCommandOptions({
    privateKeyPath: z
      .string()
      .optional()
      .describe(
        `The file to write the private key to, which must not exist; ${SIGNING_PRIVATE_KEY_FILE_NAME} in the current directory by default.`,
      ),
  }),
  action: async options => {
    const privateKeyPath = resolve(
      options.privateKeyPath ?? SIGNING_PRIVATE_KEY_FILE_NAME,
    );
    assertNoFileAt(privateKeyPath);
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(
      hotCodePush,
      options,
      projectConfigLocation.projectConfig,
    );
    const { privateKey, publicKey } = await generateSigningKeyPair();
    // Written before the public half is registered: a registered key whose private half was lost could sign nothing
    writeSigningPrivateKeyFile(privateKeyPath, privateKey);
    const createdSigningKey = await hotCodePush.apps.signingKeys
      .create({ appId, publicKey })
      .catch((error: unknown) => {
        // and removed when the registration fails, since the app would refuse what it signs
        rmSync(privateKeyPath);
        throw error;
      });
    const isConfigured = addPublicKeyToProjectConfig(
      projectConfigLocation,
      appId,
      publicKey,
    );
    if (options.json) {
      printJson({ ...createdSigningKey, privateKeyPath });
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
    console.log(`Wrote the private key to ${privateKeyPath}.`);
    console.log(
      "Keep the file out of version control: whoever holds it can sign the app's bundles.",
    );
    console.log(
      "Uploads sign with it through --private-key-path; in CI, set HOTCODEPUSH_SIGNING_KEY to the file's content.",
    );
  },
});

/**
 * The public key appended to the `publicKeys` of the `hotcodepush.json` that names the app, after the keys it lists,
 * which the next builds keep trusting beside it; a file of another app, or none, is left alone and answers false.
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

/**
 * The private key goes to a new file, checked before any request: an existing one may hold the key a store build trusts.
 */
function assertNoFileAt(filePath: string): void {
  if (existsSync(filePath)) {
    throw new InvalidParameterError(
      `--private-key-path: ${filePath} already exists`,
      undefined,
      'pass a path where no file is; signing-key create never overwrites a private key.',
    );
  }
}
