import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { MissingParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    if (options.embeddedBundle === undefined) {
      throw new MissingParameterError('--embedded-bundle');
    }
    const hotCodePush = createApiClient();
    const fetchedEmbeddedBundle = await hotCodePush.apps.embeddedBundles.get({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      embeddedBundleId: options.embeddedBundle,
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
});
