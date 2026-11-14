import { posix } from 'node:path';
import type { Audience, GetReleaseOptions, Release } from '@hotcodepush/node';
import type { CommandHarness } from './command-harness.js';
import {
  DEMO_APP,
  FLEET,
  LIVE_RELEASE,
  PREVIOUS_BUNDLE,
  PREVIOUS_RELEASE,
  PRODUCTION_CHANNEL,
  READY_BUNDLE,
  STAGING_CHANNEL,
} from './fixtures.js';

// Reaches 100 of the 120 active devices.
export const STAGING_AUDIENCE: Audience = {
  binaryVersion: [
    { deviceCount: 70, value: '2.4.1' },
    { deviceCount: 30, value: '2.3.0' },
  ],
  deviceCount: 120,
  estimatedDeviceCount: 100,
  platform: [
    { deviceCount: 60, value: 'ios' },
    { deviceCount: 40, value: 'android' },
  ],
  reachedDeviceCount: 100,
  warnings: [],
};

export const CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;

export const CHANNELS_PATH = `/v1/apps/${DEMO_APP.id}/channels`;

export const FLEET_PATH = `/v1/apps/${DEMO_APP.id}/statistics/fleet`;

export const RELEASES_PATH = `/v1/apps/${DEMO_APP.id}/releases`;

export const RELEASE_COUNTERS: NonNullable<Release['releaseCounters']> = {
  appliedUpdateCount: 100,
  confirmedUpdateCount: 90,
  crashFailureCount: 2,
  createdAt: LIVE_RELEASE.createdAt,
  downloadFailureCount: 3,
  readinessTimeoutFailureCount: 1,
  releaseId: LIVE_RELEASE.id,
  reportedFailureCount: 3,
  updatedAt: LIVE_RELEASE.updatedAt,
  verificationFailureCount: 1,
};

export const LIVE_RELEASE_WITH_RELATIONS: Release = {
  ...LIVE_RELEASE,
  bundle: READY_BUNDLE,
  channel: STAGING_CHANNEL,
  releaseCounters: RELEASE_COUNTERS,
};

export const PREVIOUS_RELEASE_WITH_RELATIONS: Release = {
  ...PREVIOUS_RELEASE,
  bundle: PREVIOUS_BUNDLE,
  channel: STAGING_CHANNEL,
  releaseCounters: { ...RELEASE_COUNTERS, releaseId: PREVIOUS_RELEASE.id },
};

const RELEASE_RELATIONS: NonNullable<GetReleaseOptions['relations']> = [
  'bundle',
  'channel',
  'releaseCounters',
];

// The relations each read of the release list or of one release named, in the order the reads were sent.
export function readReleaseRelations(harness: CommandHarness): string[][] {
  return harness.requests
    .filter(isReleaseRead)
    .map(({ url }) => resolveRequestedRelations(url));
}

export function respondWithChannels(harness: CommandHarness): void {
  harness.routes[`GET ${CHANNELS_PATH}`] = () =>
    Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);
}

export function respondWithFleet(harness: CommandHarness): void {
  harness.routes[`GET ${FLEET_PATH}`] = () => Response.json(FLEET);
}

// Serves the release by its id. Like the API, it embeds only the relations the request names.
export function respondWithRelease(
  harness: CommandHarness,
  release: Release,
): void {
  harness.routes[`GET ${RELEASES_PATH}/${release.id}`] = ({ url }) =>
    Response.json(
      resolveServedRelease(release, {
        relations: resolveRequestedRelations(url),
      }),
    );
}

// Serves the release list. Like the API, it filters by bundle and channel, pages, and embeds only the relations the request names.
export function respondWithReleases(
  harness: CommandHarness,
  releases: Release[],
): void {
  harness.routes[`GET ${RELEASES_PATH}`] = ({ url }) => {
    const relations = resolveRequestedRelations(url);
    return Response.json(
      resolveListedReleases(releases, new URL(url).searchParams).map(release =>
        resolveServedRelease(release, { relations }),
      ),
    );
  };
}

// The routes every release command starts from.
export function respondWithStagingReleases(harness: CommandHarness): void {
  respondWithChannels(harness);
  respondWithFleet(harness);
  harness.routes[`GET ${CHANNEL_PATH}`] = () => Response.json(STAGING_CHANNEL);
  respondWithReleases(harness, [
    LIVE_RELEASE_WITH_RELATIONS,
    PREVIOUS_RELEASE_WITH_RELATIONS,
  ]);
  respondWithRelease(harness, LIVE_RELEASE_WITH_RELATIONS);
}

function isReleaseRead({ method, url }: Request): boolean {
  const { pathname } = new URL(url);
  return (
    method === 'GET' &&
    (pathname === RELEASES_PATH || posix.dirname(pathname) === RELEASES_PATH)
  );
}

function resolveListedReleases(
  releases: Release[],
  searchParams: URLSearchParams,
): Release[] {
  const bundleId = searchParams.get('bundleId');
  const channelId = searchParams.get('channelId');
  const offset = Number(searchParams.get('offset') ?? 0);
  const limit = Number(searchParams.get('limit') ?? releases.length);
  return releases
    .filter(
      release =>
        (bundleId === null || release.bundleId === bundleId) &&
        (channelId === null || release.channelId === channelId),
    )
    .slice(offset, offset + limit);
}

function resolveRequestedRelations(url: string): string[] {
  return new URL(url).searchParams.get('relations')?.split(',') ?? [];
}

function resolveServedRelease(
  release: Release,
  { relations }: { relations: string[] },
): Release {
  const servedRelease = { ...release };
  for (const relation of RELEASE_RELATIONS) {
    if (!relations.includes(relation)) {
      delete servedRelease[relation];
    }
  }
  return servedRelease;
}
