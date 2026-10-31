import type {
  Channel,
  GetReleaseOptions,
  HotCodePush,
  Release,
} from '@hotcodepush/node';
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

export function resolveReleaseBundleLabel(release: Release): string {
  return release.bundle === undefined
    ? release.bundleId
    : resolveBundleLabel(release.bundle);
}

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

// The materializer stamps `liveAt` once the index is written.
// Returns the last read release after the deadline, so the caller can say it is still pending.
export async function waitUntilLive(
  hotCodePush: HotCodePush,
  appId: string,
  releaseId: string,
  relations?: GetReleaseOptions['relations'],
): Promise<Release> {
  const deadline = Date.now() + LIVE_WAIT_MS;
  for (;;) {
    const release = await hotCodePush.apps.releases.get({
      appId,
      relations,
      releaseId,
    });
    if (release.liveAt !== null || Date.now() >= deadline) {
      return release;
    }
    await new Promise(resolve => setTimeout(resolve, LIVE_POLL_INTERVAL_MS));
  }
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
