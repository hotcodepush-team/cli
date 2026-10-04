import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'List the store builds binary create registered, with the bundle each ships and the devices running it.',
  examples: [
    'hotcodepush binary list',
    'hotcodepush binary list --app "My App" --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedBinaries = await hotCodePush.apps.binaries.list({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      limit: options.limit,
      offset: options.offset,
    });
    const nextOffset = resolveNextOffset(listedBinaries.length, options);
    if (options.json) {
      printJson({ binaries: listedBinaries, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No binaries; a native build registers one.',
      headers: [
        'ID',
        'VERSION',
        'BUILD',
        'PLATFORM',
        'BUNDLE',
        'DEVICES',
        'LAST SEEN',
      ],
      nextOffset,
      rows: listedBinaries.map(
        ({
          binaryBuild,
          binaryVersion,
          bundleId,
          deviceCount,
          id,
          lastSeenAt,
          platform,
        }) => [
          id,
          binaryVersion,
          binaryBuild,
          platform,
          bundleId,
          String(deviceCount),
          lastSeenAt === null ? 'never' : resolveDate(lastSeenAt),
        ],
      ),
    });
  },
});
