import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { resolveReleaseBundleLabel } from '../../utils/release-resolution.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List a channel's releases, newest first, with the devices on each.",
  examples: [
    'hotcodepush release list',
    'hotcodepush release list --channel staging --json',
  ],
  options: defineCommandOptions({ ...channelOptionShape, ...paginationShape }),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedChannel = await fetchChannel(hotCodePush, options);
    const listedReleases = await hotCodePush.apps.channels.releases.list({
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
      limit: options.limit,
      offset: options.offset,
      relations: ['bundle'],
    });
    const nextOffset = resolveNextOffset(listedReleases.length, options);
    if (options.json) {
      printJson({ nextOffset, releases: listedReleases });
      return;
    }
    printTable({
      emptyText: `No releases in channel ${fetchedChannel.name}.`,
      headers: [
        'NUMBER',
        'BUNDLE',
        'STATE',
        'ROLLOUT',
        'MANDATORY',
        'DEVICES',
        'LIVE',
        'CREATED',
      ],
      nextOffset,
      rows: listedReleases.map(release => [
        `#${release.number}`,
        resolveReleaseBundleLabel(release),
        release.state,
        `${release.rolloutPercentage}%`,
        release.isMandatory ? 'yes' : 'no',
        String(release.deviceCount),
        release.liveAt === null ? 'pending' : resolveDate(release.liveAt),
        resolveDate(release.createdAt),
      ]),
    });
  },
});
