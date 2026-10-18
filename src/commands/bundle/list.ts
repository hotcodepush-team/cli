import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { resolveByteText } from '../../utils/progress.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

const BUNDLE_SOURCES = ['all', 'binary', 'upload'] as const;

export default defineCommand({
  description:
    "List an app's bundles, newest first: the uploaded ones by default, the ones binaries ship with --source binary, both with --source all.",
  examples: [
    'hotcodepush bundle list',
    'hotcodepush bundle list --source all --bundle-version 1.4.2 --json',
  ],
  options: defineCommandOptions({
    ...paginationShape,
    bundleVersion: z
      .string()
      .optional()
      .describe('Only the bundles carrying this version label.'),
    source: z
      .enum(BUNDLE_SOURCES)
      .optional()
      .describe(
        'upload, the bundles a release can carry, by default; binary, the ones binaries ship, which have no number; or all.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const source = options.source ?? 'upload';
    const listedBundles = await hotCodePush.apps.bundles.list({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      limit: options.limit,
      offset: options.offset,
      source: source === 'all' ? undefined : source,
      version: options.bundleVersion,
    });
    const nextOffset = resolveNextOffset(listedBundles.length, options);
    if (options.json) {
      printJson({ bundles: listedBundles, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No bundles.',
      headers: [
        'NUMBER',
        'VERSION',
        'SOURCE',
        'STATUS',
        'PLATFORMS',
        'SIZE',
        'CREATED',
      ],
      nextOffset,
      rows: listedBundles.map(
        ({
          createdAt,
          number,
          platforms,
          sizeBytes,
          source,
          status,
          version,
        }) => [
          number === null ? '' : `#${number}`,
          version,
          source,
          status,
          platforms.join(','),
          resolveByteText(sizeBytes),
          resolveDate(createdAt),
        ],
      ),
    });
  },
});
