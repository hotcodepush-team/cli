import type { Release } from '@hotcodepush/node';

export function printReleasedLine(
  release: Release,
  channelName: string,
  bundleLabel: string,
): void {
  console.log(
    `Released bundle ${bundleLabel} to ${channelName} as release #${release.number} at ${release.rolloutPercentage} percent${resolveProgressingText(release)}${resolveLiveText(release)}.`,
  );
}

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
