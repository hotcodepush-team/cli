import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

export const UPLOAD_SIGNING_TEXT =
  "Uploads sign with it through --private-key-path; in CI, set HOTCODEPUSH_SIGNING_KEY to the file's content.";

export default defineCommand({
  description:
    'Generate a key pair and add its public key to the app, the private key written to a new file on this machine: from then on the app releases only signed bundles.',
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
    assertNewFilePath(privateKeyPath);
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(
      hotCodePush,
      options,
      projectConfigLocation.projectConfig,
    );
    const { privateKey, publicKey } = await generateSigningKeyPair();
    // Written before the public key is registered, since a registered key without its private key could sign nothing.
    writeSigningPrivateKeyFile(privateKeyPath, privateKey);
    const createdSigningKey = await hotCodePush.apps.signingKeys
      .create({ appId, publicKey })
      .catch((error: unknown) => {
        // Removed when the registration fails, since the app would refuse what it signs.
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
    console.log(resolvePublicKeyListingText(isConfigured, publicKey));
    console.log(`Wrote the private key to ${privateKeyPath}.`);
    console.log(
      "Keep the file out of version control: whoever holds it can sign the app's bundles.",
    );
    console.log(UPLOAD_SIGNING_TEXT);
  },
});

// Keys already listed stay, so the next builds keep trusting them.
// A file of another app, or no file, is left alone.
export function addPublicKeyToProjectConfig(
  { filePath, projectConfig }: ProjectConfigLocation,
  appId: string,
  publicKey: string,
): boolean {
  if (filePath === undefined || projectConfig?.appId !== appId) {
    return false;
  }
  if (projectConfig.publicKeys?.includes(publicKey)) {
    return true;
  }
  writeProjectConfig(filePath, {
    ...projectConfig,
    publicKeys: [...(projectConfig.publicKeys ?? []), publicKey],
  });
  return true;
}

// An existing file may hold a key that a store build trusts, and no folder is made on the person's behalf.
function assertNewFilePath(filePath: string): void {
  if (existsSync(filePath)) {
    throw new InvalidParameterError(
      `The file ${filePath} from --private-key-path already exists.`,
      'Pass a path where no file is, since signing-key create never overwrites a private key.',
    );
  }
  const directoryPath = dirname(filePath);
  if (!statSync(directoryPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new InvalidParameterError(
      `The folder ${directoryPath} from --private-key-path does not exist.`,
      'Create the folder first, or pass a path in an existing one.',
    );
  }
}

export function resolvePublicKeyListingText(
  isConfigured: boolean,
  publicKey: string,
): string {
  return isConfigured
    ? `Added to publicKeys in ${PROJECT_CONFIG_FILE_NAME}.`
    : `Add it to publicKeys in the app's ${PROJECT_CONFIG_FILE_NAME}: ${publicKey}`;
}
