import type { Release } from '@hotcodepush/node';
import type { CommandHarness } from './command-harness.js';
import {
  DEMO_APP,
  LIVE_RELEASE,
  PREVIOUS_BUNDLE,
  PREVIOUS_RELEASE,
  PRODUCTION_CHANNEL,
  READY_BUNDLE,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from './fixtures.js';

export const CHANNEL_PATH = `/v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;

export const CHANNELS_PATH = `/v1/apps/${DEMO_APP.id}/channels`;

export const RELEASES_PATH = `/v1/apps/${DEMO_APP.id}/releases`;

export const RELEASE_COUNTERS = {
  attempted: 100,
  failedCrashed: 2,
  failedDownload: 3,
  failedReadyTimeout: 1,
  failedReported: 3,
  failedVerification: 1,
  installed: 90,
};

export const LIVE_RELEASE_WITH_RELATIONS: Release = {
  ...LIVE_RELEASE,
  bundle: READY_BUNDLE,
  channel: STAGING_CHANNEL,
  counters: RELEASE_COUNTERS,
};

export const RELEASE_LOG: Release[] = [
  { ...LIVE_RELEASE, bundle: READY_BUNDLE },
  { ...PREVIOUS_RELEASE, bundle: PREVIOUS_BUNDLE },
];

/**
 * The demo app's channels, where a channel named in a flag or in hotcodepush.json is looked up.
 */
export function respondWithChannels(harness: CommandHarness): void {
  harness.routes[`GET ${CHANNELS_PATH}`] = () =>
    Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);
}

/**
 * The staging channel of the demo app among its channels, its release log and release #43 with its relations,
 * the routes every release command starts from.
 */
export function respondWithStagingReleases(harness: CommandHarness): void {
  respondWithChannels(harness);
  harness.routes[`GET ${CHANNEL_PATH}`] = () =>
    Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);
  harness.routes[`GET ${CHANNEL_PATH}/releases`] = () =>
    Response.json(RELEASE_LOG);
  harness.routes[`GET ${RELEASES_PATH}/${LIVE_RELEASE.id}`] = () =>
    Response.json(LIVE_RELEASE_WITH_RELATIONS);
}
