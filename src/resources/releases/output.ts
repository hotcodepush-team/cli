import type { Release } from '@hotcodepush/node';
import { printNotice } from '../../utils/diagnostics.js';
import { printResult } from '../../utils/output.js';

export function printCreatedRelease(
  release: Release,
  { bundleLabel, channelName }: { bundleLabel: string; channelName: string },
): void {
  printResult({
    rows: [
      ['ID', release.id],
      ['Bundle', bundleLabel],
      ['Rollout', resolveRolloutText(release)],
      ['Live', release.liveAt ?? 'not yet'],
    ],
    sentence: `Created release #${release.number} of ${channelName}.`,
  });
  if (release.liveAt === null) {
    printNotice(
      `Run "hotcodepush release get --channel ${channelName} --release ${release.number}" to see when it is live.`,
    );
  }
}

// The steps still ahead of the release, since the schedule lists the current one too.
export function resolveRolloutText({
  progression,
  rolloutPercent,
}: Release): string {
  const nextPercents =
    progression?.rolloutPercents.filter(percent => percent > rolloutPercent) ??
    [];
  if (nextPercents.length === 0) {
    return `${rolloutPercent} percent`;
  }
  const lastPercent = nextPercents.at(-1);
  const earlierPercents = nextPercents.slice(0, -1);
  return earlierPercents.length === 0
    ? `${rolloutPercent} percent, then ${lastPercent}`
    : `${rolloutPercent} percent, then ${earlierPercents.join(', ')} and ${lastPercent}`;
}
