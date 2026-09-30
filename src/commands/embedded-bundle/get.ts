import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { isInteractive } from '../../utils/environment.js';
import { MissingParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchAllPages } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptSelect } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description: 'Print a registered store build with the bundle it embeds.',
  examples: [
    'hotcodepush embedded-bundle get --embedded-bundle 6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    'hotcodepush embedded-bundle get --embedded-bundle 6ba7b810-9dad-41d1-80b4-00c04fd430c8 --json',
  ],
  options: defineCommandOptions({
    embeddedBundle: z
      .string()
      .optional()
      .describe('The embedded bundle, by id.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const fetchedEmbeddedBundle = await hotCodePush.apps.embeddedBundles.get({
      appId,
      embeddedBundleId:
        options.embeddedBundle ??
        (await promptEmbeddedBundleId(hotCodePush, appId, options)),
      relations: ['bundle'],
    });
    if (options.json) {
      printJson(fetchedEmbeddedBundle);
      return;
    }
    printDetails([
      ['ID', fetchedEmbeddedBundle.id],
      ['Platform', fetchedEmbeddedBundle.platform],
      ['Binary version', fetchedEmbeddedBundle.binaryVersion],
      ['Binary build', fetchedEmbeddedBundle.binaryBuild],
      ['Fingerprint', fetchedEmbeddedBundle.fingerprint ?? 'none'],
      [
        'Bundle',
        fetchedEmbeddedBundle.bundle === undefined
          ? fetchedEmbeddedBundle.bundleId
          : `#${fetchedEmbeddedBundle.bundle.number} (${fetchedEmbeddedBundle.bundleId})`,
      ],
      ['Created', fetchedEmbeddedBundle.createdAt],
    ]);
  },
});

/**
 * The store build picked from the app's embedded bundles when interactive; otherwise the flag is missing.
 */
async function promptEmbeddedBundleId(
  hotCodePush: HotCodePush,
  appId: string,
  options: InteractivityOptions,
): Promise<string> {
  if (!isInteractive(options)) {
    throw new MissingParameterError('--embedded-bundle');
  }
  const embeddedBundles = await fetchAllPages(page =>
    hotCodePush.apps.embeddedBundles.list({ appId, ...page }),
  );
  return promptSelect(
    '--embedded-bundle',
    'Which store build?',
    embeddedBundles.map(({ binaryBuild, binaryVersion, id, platform }) => ({
      label: `${platform} ${binaryVersion} (${binaryBuild})`,
      value: id,
    })),
    options,
  );
}
