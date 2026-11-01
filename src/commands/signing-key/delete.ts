import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import { fetchSigningKey } from '../../resources/signing-keys.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import type { ProjectConfigLocation } from '../../utils/project-config.js';
import {
  locateProjectConfig,
  writeProjectConfig,
} from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
  description:
    'Unregister a signing key after the store release that stopped trusting it.',
  examples: [
    'hotcodepush signing-key delete --signing-key sha256:9f2c4e1ab07d',
    'hotcodepush signing-key delete --signing-key 3b1f8e7a-5c2d-4f6b-9a0e-7d4c1b2a3f5e --yes --json',
  ],
  options: defineCommandOptions({
    signingKey: z
      .string()
      .optional()
      .describe('The signing key, by id or key id.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(hotCodePush, {
      options,
      projectConfig: projectConfigLocation.projectConfig,
    });
    const signingKey = await fetchSigningKey(hotCodePush, { appId, options });
    const isConfirmed = await confirmConsequence(
      `unregisters signing key ${signingKey.keyId}: an upload signed with it is refused from then on`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.apps.signingKeys.delete({
      appId,
      signingKeyId: signingKey.id,
    });
    removePublicKeyFromProjectConfig(
      projectConfigLocation,
      appId,
      signingKey.publicKey,
    );
    if (options.json) {
      printJson({ id: signingKey.id, name: signingKey.keyId });
    } else {
      console.log(
        `Deleted signing key ${signingKey.keyId} (${signingKey.id}).`,
      );
    }
  },
});

// Removing the key from `publicKeys` makes the file and the app agree again.
function removePublicKeyFromProjectConfig(
  { filePath, projectConfig }: ProjectConfigLocation,
  appId: string,
  publicKey: string,
): void {
  if (
    filePath === undefined ||
    projectConfig?.appId !== appId ||
    !projectConfig.publicKeys?.includes(publicKey)
  ) {
    return;
  }
  writeProjectConfig(filePath, {
    ...projectConfig,
    publicKeys: projectConfig.publicKeys.filter(
      listedPublicKey => listedPublicKey !== publicKey,
    ),
  });
}
