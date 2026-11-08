import type { Bundle } from '@hotcodepush/node';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printJson,
  printTable,
  resolveDate,
  resolveByteText,
} from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';

export default defineCommand({
  description:
    "List an app's uploaded bundles, newest first. The bundle a binary ships is in binary list and binary get.",
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
      appId: await fetchAppId(hotCodePush, {
        options,
        projectConfig: readProjectConfig(options.config),
      }),
      limit: options.limit,
      offset: options.offset,
      version: options.bundleVersion,
    });
    const nextOffset = resolveNextOffset(listedBundles.length, options);
    if (options.json) {
      printJson({ bundles: listedBundles, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No bundles.',
      headers: ['NUMBER', 'VERSION', 'STATUS', 'PLATFORMS', 'SIZE', 'CREATED'],
      nextOffset,
      rows: listedBundles.map(resolveBundleRow),
    });
  },
});

function resolveBundleRow({
  createdAt,
  number,
  platforms,
  sizeBytes,
  status,
  version,
}: Bundle): string[] {
  return [
    number === null ? '' : `#${number}`,
    version,
    status,
    platforms.join(','),
    resolveByteText(sizeBytes),
    resolveDate(createdAt),
  ];
}
