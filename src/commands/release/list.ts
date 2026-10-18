import type { Release } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveReleaseDeviceCount } from '../../utils/fleet.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { resolveProgressionStepText } from '../../utils/progression.js';
import { resolveReleaseBundleLabel } from '../../utils/release-resolution.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List a channel's releases, newest first, with the progression and the devices on each.",
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
      relations: ['bundle', 'releaseCounters'],
    });
    const nextOffset = resolveNextOffset(listedReleases.length, options);
    if (options.json) {
      printJson({ nextOffset, releases: listedReleases });
      return;
    }
    const fleet = await hotCodePush.apps.statistics.fleet.get({
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
    });
    printTable({
      emptyText: `No releases in channel ${fetchedChannel.name}.`,
      headers: [
        'NUMBER',
        'BUNDLE',
        'STATUS',
        'ROLLOUT',
        'PROGRESSION',
        'MANDATORY',
        'DEVICES',
        'LIVE',
        'CREATED',
      ],
      nextOffset,
      rows: listedReleases.map(release => [
        `#${release.number}`,
        resolveReleaseBundleLabel(release),
        release.status,
        `${release.rolloutPercentage}%`,
        resolveProgressionCell(release),
        release.isMandatory ? 'yes' : 'no',
        String(resolveReleaseDeviceCount(fleet, release.id)),
        release.liveAt === null ? 'pending' : resolveDate(release.liveAt),
        resolveDate(release.createdAt),
      ]),
    });
  },
});

/**
 * The schedule's percentages with the step reached and its gate, `10,50,100% · 1 of 3, waiting on sample: 12 of 50 attempts`.
 */
function resolveProgressionCell(release: Release): string {
  const { progression } = release;
  return progression === null
    ? 'none'
    : `${progression.percentages.join(',')}% · ${resolveProgressionStepText(release, progression)}`;
}
