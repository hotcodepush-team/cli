import type { Audience, Release } from '@hotcodepush/node';
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

/**
 * What the staging channel's audience preview answers: 100 of its 120 active devices reached.
 */
export const STAGING_AUDIENCE: Audience = {
  byBinaryVersion: [
    { deviceCount: 70, value: '2.4.1' },
    { deviceCount: 30, value: '2.3.0' },
  ],
  byPlatform: [
    { deviceCount: 60, value: 'ios' },
    { deviceCount: 40, value: 'android' },
  ],
  deviceCount: 120,
  estimatedDeviceCount: 100,
  reachedDeviceCount: 100,
  warnings: [],
};

export const CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;

export const CHANNELS_PATH = `/v1/apps/${DEMO_APP.id}/channels`;

export const FLEET_PATH = `/v1/apps/${DEMO_APP.id}/statistics/fleet`;

export const RELEASES_PATH = `/v1/apps/${DEMO_APP.id}/releases`;

export const RELEASE_COUNTERS: NonNullable<Release['releaseCounters']> = {
  appliedUpdateCount: 90,
  attemptedUpdateCount: 100,
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

export const RELEASE_LOG: Release[] = [
  { ...LIVE_RELEASE, bundle: READY_BUNDLE },
  { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE },
];

/**
 * The demo app's fleet, for the app and for any channel.
 */
export function respondWithFleet(harness: CommandHarness): void {
  harness.routes[`GET ${FLEET_PATH}`] = () => Response.json(FLEET);
}

/**
 * The demo app's channels, where a channel named in a flag or in hotcodepush.json is looked up.
 */
export function respondWithChannels(harness: CommandHarness): void {
  harness.routes[`GET ${CHANNELS_PATH}`] = () =>
    Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);
}

/**
 * The staging channel of the demo app among its channels, its release log, release #43 with its relations and the fleet,
 * the routes every release command starts from.
 */
export function respondWithStagingReleases(harness: CommandHarness): void {
  respondWithChannels(harness);
  respondWithFleet(harness);
  harness.routes[`GET ${CHANNEL_PATH}`] = () => Response.json(STAGING_CHANNEL);
  harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
    Response.json(RELEASE_LOG);
  harness.routes[`GET ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
    Response.json(LIVE_RELEASE_WITH_RELATIONS);
}
