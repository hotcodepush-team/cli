import type { Release } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
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
    'Print a release with its rollout, its progression, its status and its counters: attempted, applied and failed by reason.',
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
      ['Status', resolveStatusText(release)],
      ['Rollout', `${release.rolloutPercentage}%`],
      ...resolveProgressionDetails(release),
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
    ['Attempted', String(counters.attemptedUpdateCount)],
    ['Applied', String(counters.appliedUpdateCount)],
    ['Download failures', String(counters.downloadFailureCount)],
    ['Verification failures', String(counters.verificationFailureCount)],
    ['Crash failures', String(counters.crashFailureCount)],
    [
      'Readiness timeout failures',
      String(counters.readinessTimeoutFailureCount),
    ],
    ['Reported failures', String(counters.reportedFailureCount)],
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
