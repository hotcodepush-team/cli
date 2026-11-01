import type { FleetStatistics, Release } from '@hotcodepush/node';
import {
  channelOptionShape,
  fetchChannel,
} from '../../resources/channels/fetch.js';
import { resolveReleaseBundleLabel } from '../../resources/releases/fetch.js';
import { resolveProgressionStepText } from '../../resources/releases/progression.js';
import { resolveReleaseDeviceCount } from '../../resources/statistics.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printJson,
  printTable,
  resolveDate,
  resolveYesNoText,
} from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';

const RELEASE_TABLE_HEADERS = [
  'NUMBER',
  'BUNDLE',
  'STATUS',
  'ROLLOUT',
  'PROGRESSION',
  'MANDATORY',
  'DEVICES',
  'LIVE',
  'CREATED',
];

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
    const listedReleases = await hotCodePush.apps.releases.list({
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
      headers: RELEASE_TABLE_HEADERS,
      nextOffset,
      rows: listedReleases.map(release => resolveReleaseRow(release, fleet)),
    });
  },
});

function resolveProgressionCell(release: Release): string {
  const { progression } = release;
  return progression === null
    ? 'none'
    : `${progression.rolloutPercents.join(',')}% · ${resolveProgressionStepText(release, progression)}`;
}

function resolveReleaseRow(release: Release, fleet: FleetStatistics): string[] {
  return [
    `#${release.number}`,
    resolveReleaseBundleLabel(release),
    release.status,
    `${release.rolloutPercent}%`,
    resolveProgressionCell(release),
    resolveYesNoText(release.isMandatory),
    String(resolveReleaseDeviceCount(fleet, release.id)),
    release.liveAt === null ? 'pending' : resolveDate(release.liveAt),
    resolveDate(release.createdAt),
  ];
}
