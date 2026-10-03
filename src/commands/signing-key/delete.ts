import type { HotCodePush, SigningKey } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { fetchAllPages } from '../../utils/pagination.js';
import type { ProjectConfigLocation } from '../../utils/project-config.js';
import {
  locateProjectConfig,
  writeProjectConfig,
} from '../../utils/project-config.js';
import { confirmConsequence, promptSelect } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Unregister a signing key after the store release that stopped trusting it; the app keeps at least one.',
  examples: [
    'hotcodepush signing-key delete --signing-key sha256:9f2c4e1ab07d',
    'hotcodepush signing-key delete --signing-key 3b1f8e7a-5c2d-4f6b-9a0e-7d4c1b2a3f5e --yes --json',
  ],
  options: defineCommandOptions({
    signingKey: z
      .string()
      .optional()
      .describe('The signing key, by id or fingerprint.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const projectConfigLocation = locateProjectConfig(options.config);
    const appId = await fetchAppId(
      hotCodePush,
      options,
      projectConfigLocation.projectConfig,
    );
    const signingKeys = await fetchSigningKeys(hotCodePush, appId);
    const signingKey = resolveSigningKey(
      signingKeys,
      options.signingKey ??
        (await promptSelect(
          '--signing-key',
          'Which signing key?',
          signingKeys.map(({ fingerprint, id }) => ({
            label: fingerprint,
            value: id,
          })),
          options,
        )),
    );
    const isConfirmed = await confirmConsequence(
      `unregisters signing key ${signingKey.fingerprint}: an upload signed with it is refused from then on`,
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
      printJson({ fingerprint: signingKey.fingerprint, id: signingKey.id });
    } else {
      console.log(
        `Deleted signing key ${signingKey.fingerprint} (${signingKey.id}).`,
      );
    }
  },
});

function fetchSigningKeys(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<SigningKey[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.signingKeys.list({ appId, ...page }),
  );
}

/**
 * The key `hotcodepush.json` of the app still lists leaves its `publicKeys`, so the file and the app agree again.
 */
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

function resolveSigningKey(
  signingKeys: SigningKey[],
  reference: string,
): SigningKey {
  const signingKey = signingKeys.find(
    ({ fingerprint, id }) => id === reference || fingerprint === reference,
  );
  if (signingKey === undefined) {
    throw new InvalidParameterError(
      `--signing-key: the app has no signing key ${reference}`,
      undefined,
      'run "hotcodepush signing-key list" for the ids and fingerprints.',
    );
  }
  return signingKey;
}
