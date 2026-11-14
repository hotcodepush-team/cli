import type { Release } from '@hotcodepush/node';
import { channelOptionShape } from '../../resources/channels/fetch.js';
import {
  resolveEffectiveFailurePolicy,
  resolveFailurePolicyDetails,
} from '../../resources/channels/fields.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
  resolveReleaseBundleLabel,
} from '../../resources/releases/fetch.js';
import {
  resolveProgressionStepText,
  resolveProgressionText,
} from '../../resources/releases/progression.js';
import { resolveReleaseDeviceCount } from '../../resources/statistics.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printDetails,
  printJson,
  resolveYesNoText,
} from '../../utils/output.js';

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
    const { channel, release } = await fetchReleaseInChannel(hotCodePush, {
      options,
      relations: ['bundle', 'releaseCounters'],
    });
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
      ['Rollout', `${release.rolloutPercent}%`],
      ...resolveProgressionDetails(release),
      ...resolveFailurePolicyDetails(
        resolveEffectiveFailurePolicy(release, { channelFields: channel }),
      ),
      ['Mandatory', resolveYesNoText(release.isMandatory)],
      ['Notes', release.notes ?? 'none'],
      ['Rolled back from', release.rolledBackFromReleaseId ?? 'nothing'],
      ['Live', release.liveAt ?? 'not yet'],
      [
        'Devices',
        String(resolveReleaseDeviceCount(fleet, { releaseId: release.id })),
      ],
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
