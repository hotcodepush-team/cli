import type { SigningKey } from '@hotcodepush/node';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import { fetchSigningKey } from '../../resources/signing-keys.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';

export default defineCommand({
  description:
    "Print a signing key with its public key, the value hotcodepush.json's publicKeys lists.",
  examples: [
    'hotcodepush signing-key get --signing-key sha256:9f2c4e1ab07d',
    'hotcodepush signing-key get --signing-key 3b1f8e7a-5c2d-4f6b-9a0e-7d4c1b2a3f5e --json',
  ],
  options: defineCommandOptions({
    signingKey: z
      .string()
      .optional()
      .describe('The signing key, by id or key id.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(hotCodePush, {
      options,
      projectConfig: readProjectConfig(options.config),
    });
    const fetchedSigningKey = await fetchSigningKey(hotCodePush, {
      appId,
      options,
    });
    if (options.json) {
      printJson(fetchedSigningKey);
      return;
    }
    printSigningKeyDetails(fetchedSigningKey);
  },
});

function printSigningKeyDetails(signingKey: SigningKey): void {
  printDetails([
    ['ID', signingKey.id],
    ['Key ID', signingKey.keyId],
    ['Public key', signingKey.publicKey],
    ['Created', signingKey.createdAt],
  ]);
}
