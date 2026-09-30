import type { Release } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
  resolveReleaseBundleLabel,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Print a release with its rollout, its state and its counters: attempted, installed and failed by reason.',
  examples: [
    'hotcodepush release get --release 43',
    'hotcodepush release get --channel staging --release 43 --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
  }),
  action: async options => {
    const { channel, release } = await fetchReleaseInChannel(
      createApiClient(),
      options,
    );
    if (options.json) {
      printJson(release);
      return;
    }
    printDetails([
      ['ID', release.id],
      ['Number', `#${release.number}`],
      ['Channel', channel.name],
      ['Bundle', `${resolveReleaseBundleLabel(release)} (${release.bundleId})`],
      ['State', resolveStateText(release)],
      ['Rollout', `${release.rolloutPercentage}%`],
      ['Mandatory', release.isMandatory ? 'yes' : 'no'],
      ['Notes', release.notes ?? 'none'],
      ['Rolled back from', release.rolledBackFromReleaseId ?? 'nothing'],
      ['Live', release.liveAt ?? 'not yet'],
      ['Devices', String(release.deviceCount)],
      ...resolveCounterDetails(release),
      ['Created', release.createdAt],
    ]);
  },
});

function resolveCounterDetails({
  counters,
}: Release): [label: string, value: string][] {
  if (counters === undefined) {
    return [];
  }
  return [
    ['Attempted', String(counters.attempted)],
    ['Installed', String(counters.installed)],
    ['Failed download', String(counters.failedDownload)],
    ['Failed verification', String(counters.failedVerification)],
    ['Failed crashed', String(counters.failedCrashed)],
    ['Failed ready timeout', String(counters.failedReadyTimeout)],
    ['Failed reported', String(counters.failedReported)],
  ];
}

function resolveStateText(release: Release): string {
  return release.state === 'paused' && release.pausedAt !== null
    ? `paused since ${release.pausedAt}`
    : release.state;
}
