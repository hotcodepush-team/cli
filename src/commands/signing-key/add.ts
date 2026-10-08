import { resolve } from 'node:path';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { locateProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';
import { readSigningKeyPairFile } from '../../utils/signing-private-key.js';
import {
  addPublicKeyToProjectConfig,
  resolvePublicKeyListingText,
  UPLOAD_SIGNING_TEXT,
} from './create.js';

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
        'The private key file of the pair, a PEM of PKCS #8 or PKCS #1, read on this machine; its public key is derived from it.',
      ),
  }),
  action: async options => {
    const privateKeyPath = resolve(
      options.privateKeyPath ??
        (await promptText(
          '--private-key-path',
          'Which private key file?',
          options,
        )),
    );
    // read before any request: a file that holds no RSA key of the minimum size is refused here
    const { publicKey } = await readSigningKeyPairFile(privateKeyPath);
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(
      hotCodePush,
      options,
      projectConfigLocation.projectConfig,
    );
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
      printJson(createdSigningKey);
      return;
    }
    console.log(
      `Added signing key ${createdSigningKey.fingerprint} (${createdSigningKey.id}).`,
    );
    console.log(resolvePublicKeyListingText(isConfigured, publicKey));
    console.log(UPLOAD_SIGNING_TEXT);
  },
});
