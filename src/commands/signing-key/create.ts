import { existsSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SigningKey } from '@hotcodepush/node';
import { generateSigningKeyPair } from '@hotcodepush/protocol';
import { z } from 'zod';
import { SIGNING_PRIVATE_KEY_FILE_NAME } from '../../config/consts.js';
import { fetchAppId } from '../../resources/apps.js';
import {
  addPublicKeyToProjectConfig,
  PUBLIC_KEY_LISTING_NOTICE,
  UPLOAD_SIGNING_NOTICE,
  resolvePublicKeyRow,
} from '../../resources/signing-keys.js';
import { writeSigningPrivateKeyFile } from '../../upload/signing-private-key.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printNotice, printWarning } from '../../utils/diagnostics.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { locateProjectConfig } from '../../utils/project-config.js';

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
    const appId = await fetchAppId(hotCodePush, {
      options,
      projectConfig: projectConfigLocation.projectConfig,
    });
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
    const isConfigured = addPublicKeyToProjectConfig(projectConfigLocation, {
      appId,
      publicKey,
    });
    if (options.json) {
      printJson({ ...createdSigningKey, privateKeyPath });
      return;
    }
    printCreatedSigningKey(createdSigningKey, { isConfigured, privateKeyPath });
  },
});

function printCreatedSigningKey(
  { id, keyId, publicKey }: SigningKey,
  {
    isConfigured,
    privateKeyPath,
  }: { isConfigured: boolean; privateKeyPath: string },
): void {
  printResult({
    rows: [
      ['ID', id],
      ['Key ID', keyId],
      ['Private key', privateKeyPath],
      resolvePublicKeyRow({ isConfigured, publicKey }),
    ],
    sentence: 'Created a signing key.',
  });
  printWarning(
    "Keep the private key file out of version control. Whoever holds it can sign the app's bundles.",
  );
  if (!isConfigured) {
    printNotice(PUBLIC_KEY_LISTING_NOTICE);
  }
  printNotice(UPLOAD_SIGNING_NOTICE);
}

// An existing file may hold a key that a store build trusts, and no folder is made on the person's behalf.
function assertNewFilePath(filePath: string): void {
  if (existsSync(filePath)) {
    throw new InvalidParameterError(
      `The file ${filePath} from --private-key-path already exists.`,
      {
        fix: 'Pass a path where no file is, since signing-key create never overwrites a private key.',
      },
    );
  }
  const directoryPath = dirname(filePath);
  if (!statSync(directoryPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new InvalidParameterError(
      `The folder ${directoryPath} from --private-key-path does not exist.`,
      { fix: 'Create the folder first, or pass a path in an existing one.' },
    );
  }
}
