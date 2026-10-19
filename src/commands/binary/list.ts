import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  resolveBinaryBucket,
  UNSEEN_IN_FLEET_WINDOW_TEXT,
} from '../../utils/fleet.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'List the binaries, the store builds whose build created one, with the bundle each ships and the devices running it.',
  examples: [
    'hotcodepush binary list',
    'hotcodepush binary list --app "My App" --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const listedBinaries = await hotCodePush.apps.binaries.list({
      appId,
      limit: options.limit,
      offset: options.offset,
    });
    const nextOffset = resolveNextOffset(listedBinaries.length, options);
    if (options.json) {
      printJson({ binaries: listedBinaries, nextOffset });
      return;
    }
    const fleet = await hotCodePush.apps.statistics.fleet.get({ appId });
    printTable({
      emptyText: 'No binaries; a store build creates one.',
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
      rows: listedBinaries.map(({ build, bundleId, id, platform, version }) => {
        const binaryBucket = resolveBinaryBucket(fleet, id);
        return [
          id,
          version,
          build,
          platform,
          bundleId,
          String(binaryBucket?.deviceCount ?? 0),
          binaryBucket === undefined
            ? UNSEEN_IN_FLEET_WINDOW_TEXT
            : resolveDate(binaryBucket.lastSeenAt),
        ];
      }),
    });
  },
});
