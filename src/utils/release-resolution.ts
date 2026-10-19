import type { Channel, HotCodePush, Release } from '@hotcodepush/node';
import { z } from 'zod';
import { resolveBundleLabel } from './bundle-resolution.js';
import { InvalidParameterError } from './errors.js';
import { fetchAllPages } from './pagination.js';
import { ID_SCHEMA } from './project-config.js';
import { promptSelect } from './prompts.js';
import type { ChannelOptions } from './resource-resolution.js';
import { fetchChannel } from './resource-resolution.js';

export interface ReleaseInChannel {
  channel: Channel;
  release: Release;
}

export interface ReleaseOptions extends ChannelOptions {
  release?: string;
}

const LIVE_POLL_INTERVAL_MS = 1000;

const LIVE_WAIT_MS = 60_000;

const NUMBER_PATTERN = /^\d+$/;

export const releaseOptionShape = {
  release: z
    .string()
    .optional()
    .describe('The release, by its number in the channel or by its id.'),
};

/**
 * The release `--release` names in the channel `--channel` names, with its bundle, channel and counters:
 * a number is looked up in the channel's log, and no `--release` is a picker over the log when interactive.
 */
export async function fetchReleaseInChannel(
  hotCodePush: HotCodePush,
  options: ReleaseOptions,
): Promise<ReleaseInChannel> {
  const channel = await fetchChannel(hotCodePush, options);
  const releaseId = await resolveReleaseId(hotCodePush, channel, options);
  const release = await hotCodePush.apps.releases.get({
    appId: channel.appId,
    relations: ['bundle', 'channel', 'releaseCounters'],
    releaseId,
  });
  if (release.channelId !== channel.id) {
    throw new InvalidParameterError(
      `The release ${releaseId} from --release is not in channel ${channel.name}.`,
    );
  }
  return { channel, release };
}

/**
 * The channel's release log, newest first and complete, each release with its bundle.
 */
export function fetchReleaseLog(
  hotCodePush: HotCodePush,
  channel: Channel,
): Promise<Release[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.channels.releases.list({
      appId: channel.appId,
      channelId: channel.id,
      relations: ['bundle'],
      ...page,
    }),
  );
}

/**
 * The bundle a release carries as `#17 · 1.4.2` when the relation came along, else its id.
 */
export function resolveReleaseBundleLabel(release: Release): string {
  return release.bundle === undefined
    ? release.bundleId
    : resolveBundleLabel(release.bundle);
}

/**
 * The release a flag names in a log, by its number in the channel or by its id.
 */
export function resolveReleaseInLog(
  releases: Release[],
  reference: string,
  flag: string,
): Release {
  const release = ID_SCHEMA.safeParse(reference).success
    ? releases.find(({ id }) => id === reference)
    : NUMBER_PATTERN.test(reference)
      ? releases.find(({ number }) => number === Number(reference))
      : undefined;
  if (release === undefined) {
    throw new InvalidParameterError(
      `The channel has no release "${reference}" from ${flag}.`,
      `Name a release of the channel by number or id with ${flag}.`,
    );
  }
  return release;
}

/**
 * Waits until the release is live — the materializer stamps `liveAt` once the index is written — for a bounded time;
 * the release as last seen either way, so the caller says when it is still pending.
 */
export async function waitUntilLive(
  hotCodePush: HotCodePush,
  appId: string,
  release: Release,
): Promise<Release> {
  const deadline = Date.now() + LIVE_WAIT_MS;
  let latestRelease = release;
  while (latestRelease.liveAt === null) {
    latestRelease = await hotCodePush.apps.releases.get({
      appId,
      releaseId: release.id,
    });
    if (latestRelease.liveAt !== null || Date.now() >= deadline) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, LIVE_POLL_INTERVAL_MS));
  }
  return latestRelease;
}

async function resolveReleaseId(
  hotCodePush: HotCodePush,
  channel: Channel,
  options: ReleaseOptions,
): Promise<string> {
  if (
    options.release !== undefined &&
    ID_SCHEMA.safeParse(options.release).success
  ) {
    return options.release;
  }
  const releases = await fetchReleaseLog(hotCodePush, channel);
  if (options.release !== undefined) {
    return resolveReleaseInLog(releases, options.release, '--release').id;
  }
  return promptSelect(
    '--release',
    'Which release?',
    releases.map(release => ({
      label: `#${release.number} · ${resolveReleaseBundleLabel(release)} (${release.status})`,
      value: release.id,
    })),
    options,
  );
}
