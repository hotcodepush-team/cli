import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { resolveByteText } from '../../utils/progress.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description: "List an app's bundles, newest first.",
  examples: [
    'hotcodepush bundle list',
    'hotcodepush bundle list --bundle-version 1.4.2 --json',
  ],
  options: defineCommandOptions({
    ...paginationShape,
    bundleVersion: z
      .string()
      .optional()
      .describe('Only the bundles carrying this version label.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedBundles = await hotCodePush.apps.bundles.list({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      bundleVersion: options.bundleVersion,
      limit: options.limit,
      offset: options.offset,
    });
    const nextOffset = resolveNextOffset(listedBundles.length, options);
    if (options.json) {
      printJson({ bundles: listedBundles, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No bundles.',
      headers: ['NUMBER', 'VERSION', 'STATE', 'PLATFORMS', 'SIZE', 'CREATED'],
      nextOffset,
      rows: listedBundles.map(
        ({ bundleVersion, createdAt, number, platforms, sizeBytes, state }) => [
          `#${number}`,
          bundleVersion,
          state,
          platforms.join(','),
          resolveByteText(sizeBytes),
          resolveDate(createdAt),
        ],
      ),
    });
  },
});
