import type { Release } from '@hotcodepush/node';

export function printReleasedLine(
  release: Release,
  { bundleLabel, channelName }: { bundleLabel: string; channelName: string },
): void {
  console.log(
    `Released bundle ${bundleLabel} to ${channelName} as release #${release.number} at ${release.rolloutPercent} percent${resolveProgressingText(release)}${resolveLiveText(release)}.`,
  );
}

export function resolveProgressingText({ progression }: Release): string {
  return progression === null
    ? ''
    : `, progressing through ${progression.rolloutPercents.join(', ')} percent`;
}

function resolveLiveText(release: Release): string {
  return release.liveAt === null
    ? '. Not live yet, and "release get" shows when it is'
    : `, live since ${release.liveAt}`;
}
