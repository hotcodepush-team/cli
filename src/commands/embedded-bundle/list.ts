import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const listedEmbeddedBundles = await hotCodePush.apps.embeddedBundles.list({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      limit: options.limit,
      offset: options.offset,
    });
    const nextOffset = resolveNextOffset(listedEmbeddedBundles.length, options);
    if (options.json) {
      printJson({ embeddedBundles: listedEmbeddedBundles, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No embedded bundles; a native build registers one.',
      headers: ['ID', 'PLATFORM', 'VERSION', 'BUILD', 'FINGERPRINT', 'CREATED'],
      nextOffset,
      rows: listedEmbeddedBundles.map(
        ({
          binaryBuild,
          binaryVersion,
          createdAt,
          fingerprint,
          id,
          platform,
        }) => [
          id,
          platform,
          binaryVersion,
          binaryBuild,
          fingerprint ?? 'none',
          resolveDate(createdAt),
        ],
      ),
    });
  },
  description:
    'List the store builds registered by the embed step, with their binary identity.',
  examples: [
    'hotcodepush embedded-bundle list',
    'hotcodepush embedded-bundle list --app "My App" --json',
  ],
  options: defineCommandOptions(paginationShape),
});
