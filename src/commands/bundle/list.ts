import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { resolveByteText } from '../../utils/progress.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

const BUNDLE_TYPES = ['all', 'embedded', 'uploaded'] as const;

export default defineCommand({
  description:
    "List an app's bundles, newest first: the uploaded ones by default, the ones binaries ship with --type embedded, both with --type all.",
  examples: [
    'hotcodepush bundle list',
    'hotcodepush bundle list --type all --bundle-version 1.4.2 --json',
  ],
  options: defineCommandOptions({
    ...paginationShape,
    bundleVersion: z
      .string()
      .optional()
      .describe('Only the bundles carrying this version label.'),
    type: z
      .enum(BUNDLE_TYPES)
      .optional()
      .describe(
        'uploaded, the bundles a release can carry, by default; embedded, the ones binaries ship, which have no number; or all.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const type = options.type ?? 'uploaded';
    const listedBundles = await hotCodePush.apps.bundles.list({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      limit: options.limit,
      offset: options.offset,
      type: type === 'all' ? undefined : type,
      version: options.bundleVersion,
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
        ({ createdAt, number, platforms, sizeBytes, state, version }) => [
          number === null ? '' : `#${number}`,
          version,
          state,
          platforms.join(','),
          resolveByteText(sizeBytes),
          resolveDate(createdAt),
        ],
      ),
    });
  },
});
