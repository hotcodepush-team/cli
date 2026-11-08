import type { Release } from '@hotcodepush/node';
import type { Platform } from '../../upload/upload.js';

// Null means any platform.
export function findNewestActiveRelease(
  releases: Release[],
  { platform }: { platform: Platform | null },
): Release | undefined {
  return releases
    .filter(
      release =>
        release.status === 'active' &&
        (platform === null || isReleaseServing(release, platform)),
    )
    .sort((left, right) => right.number - left.number)[0];
}

// The log embeds each release's bundle, so a release without one serves nothing known.
export function isReleaseServing(
  release: Release,
  platform: Platform,
): boolean {
  return release.bundle?.platforms.includes(platform) ?? false;
}
