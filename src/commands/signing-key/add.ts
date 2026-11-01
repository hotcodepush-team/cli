import { resolve } from 'node:path';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import {
  UPLOAD_SIGNING_TEXT,
  addPublicKeyToProjectConfig,
  resolvePublicKeyListingText,
} from '../../resources/signing-keys.js';
import { readSigningKeyPairFile } from '../../upload/signing-private-key.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { locateProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';

export default defineCommand({
  description:
    'Add the public key of a key pair you already have, from its private key file, which stays where it is: from then on the app releases only signed bundles.',
  examples: [
    'hotcodepush signing-key add --private-key-path my-app-private-key.pem',
    'hotcodepush signing-key add --app "My App" --private-key-path my-app-private-key.pem --json',
  ],
  options: defineCommandOptions({
    privateKeyPath: z
      .string()
      .optional()
      .describe(
        'The private key file of the pair, a PEM of PKCS #8 or PKCS #1, read on this machine. Its public key is derived from it.',
      ),
  }),
  action: async options => {
    const privateKeyPath = resolve(
      options.privateKeyPath ??
        (await promptText(options, {
          flag: '--private-key-path',
          message: 'Which private key file?',
        })),
    );
    // Read before any request, so a key that is too small or not RSA is refused first.
    const { publicKey } = await readSigningKeyPairFile(privateKeyPath);
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(hotCodePush, {
      options,
      projectConfig: projectConfigLocation.projectConfig,
    });
    const createdSigningKey = await hotCodePush.apps.signingKeys.create({
      appId,
      publicKey,
    });
    const isConfigured = addPublicKeyToProjectConfig(projectConfigLocation, {
      appId,
      publicKey,
    });
    if (options.json) {
      printJson(createdSigningKey);
      return;
    }
    console.log(
      `Added signing key ${createdSigningKey.keyId} (${createdSigningKey.id}).`,
    );
    console.log(resolvePublicKeyListingText({ isConfigured, publicKey }));
    console.log(UPLOAD_SIGNING_TEXT);
  },
});
