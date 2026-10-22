import type { Release } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  resolveEffectiveFailurePolicy,
  resolveFailurePolicyDetails,
} from '../../utils/channel-fields.js';
import { resolveReleaseDeviceCount } from '../../utils/fleet.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import {
  resolveProgressionStepText,
  resolveProgressionText,
} from '../../utils/progression.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
  resolveReleaseBundleLabel,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Print a release with its rollout, its progression, its effective auto-pause policy, its status and its counters: applied, confirmed and failed by reason.',
  examples: [
    'hotcodepush release get --release 43',
    'hotcodepush release get --channel staging --release 43 --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    if (options.json) {
      printJson(release);
      return;
    }
    const fleet = await hotCodePush.apps.statistics.fleet.get({
      appId: channel.appId,
      channelId: channel.id,
    });
    printDetails([
      ['ID', release.id],
      ['Number', `#${release.number}`],
      ['Channel', channel.name],
      ['Bundle', `${resolveReleaseBundleLabel(release)} (${release.bundleId})`],
      ['Status', resolveStatusText(release)],
      ['Rollout', `${release.rolloutPercentage}%`],
      ...resolveProgressionDetails(release),
      ...resolveFailurePolicyDetails(
        resolveEffectiveFailurePolicy(release, channel),
      ),
      ['Mandatory', release.isMandatory ? 'yes' : 'no'],
      ['Notes', release.notes ?? 'none'],
      ['Rolled back from', release.rolledBackFromReleaseId ?? 'nothing'],
      ['Live', release.liveAt ?? 'not yet'],
      ['Devices', String(resolveReleaseDeviceCount(fleet, release.id))],
      ...resolveCounterDetails(release),
      ['Created', release.createdAt],
    ]);
  },
});

function resolveCounterDetails({
  releaseCounters,
}: Release): [label: string, value: string][] {
  if (releaseCounters === undefined) {
    return [];
  }
  return [
    ['Applied', String(releaseCounters.appliedUpdateCount)],
    ['Confirmed', String(releaseCounters.confirmedUpdateCount)],
    ['Download failures', String(releaseCounters.downloadFailureCount)],
    ['Verification failures', String(releaseCounters.verificationFailureCount)],
    ['Crash failures', String(releaseCounters.crashFailureCount)],
    [
      'Readiness timeout failures',
      String(releaseCounters.readinessTimeoutFailureCount),
    ],
    ['Reported failures', String(releaseCounters.reportedFailureCount)],
  ];
}

/**
 * The schedule and, while one runs, the step it reached with the gate the next widening waits on.
 */
function resolveProgressionDetails(
  release: Release,
): [label: string, value: string][] {
  const { progression } = release;
  if (progression === null) {
    return [['Progression', 'none']];
  }
  return [
    ['Progression', resolveProgressionText(progression)],
    ['Progression step', resolveProgressionStepText(release, progression)],
  ];
}

function resolveStatusText(release: Release): string {
  return release.status === 'paused' && release.pausedAt !== null
    ? `paused since ${release.pausedAt}`
    : release.status;
}
