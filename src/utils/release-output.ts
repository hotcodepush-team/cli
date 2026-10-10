import type { Release } from '@hotcodepush/node';

/**
 * The line a release ends on: `Released bundle #17 · 1.4.2 to staging as release #43 at 100 percent, live since …`.
 */
export function printReleasedLine(
  release: Release,
  channelName: string,
  bundleLabel: string,
): void {
  console.log(
    `Released bundle ${bundleLabel} to ${channelName} as release #${release.number} at ${release.rolloutPercentage} percent${resolveProgressingText(release)}${resolveLiveText(release)}.`,
  );
}

/**
 * The schedule a release widens through, for the line a command ends on: `, progressing through 10, 50, 100 percent`.
 */
export function resolveProgressingText({ progression }: Release): string {
  return progression === null
    ? ''
    : `, progressing through ${progression.percentages.join(', ')} percent`;
}

function resolveLiveText(release: Release): string {
  return release.liveAt === null
    ? '; not live yet, and "release get" shows when it is'
    : `, live since ${release.liveAt}`;
}
