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
    `Released bundle ${bundleLabel} to ${channelName} as release #${release.number} at ${release.rolloutPercentage} percent${resolveLiveText(release)}.`,
  );
}

function resolveLiveText(release: Release): string {
  return release.liveAt === null
    ? '; not live yet, and "release get" shows when it is'
    : `, live since ${release.liveAt}`;
}
