import type {
  Channel,
  GetReleaseOptions,
  HotCodePush,
  ListReleasesOptions,
  Release,
} from '@hotcodepush/node';
import { z } from 'zod';
import { InvalidParameterError } from '../../utils/errors.js';
import { fetchAllPages } from '../../utils/pagination.js';
import { promptSelect } from '../../utils/prompts.js';
import { isId, isNumber } from '../../utils/reference.js';
import { resolveBundleLabel } from '../bundles.js';
import type { ChannelOptions } from '../channels/fetch.js';
import { fetchChannel } from '../channels/fetch.js';

export interface ReleaseInChannel {
  channel: Channel;
  release: Release;
}

export interface ReleaseOptions extends ChannelOptions {
  release?: string;
}

const LIVE_POLL_INTERVAL_MS = 1000;

const LIVE_WAIT_MS = 60_000;

export const releaseOptionShape = {
  release: z
    .string()
    .optional()
    .describe('The release, by its number in the channel or by its id.'),
};

export async function fetchReleaseInChannel(
  hotCodePush: HotCodePush,
  {
    options,
    relations,
  }: { options: ReleaseOptions; relations?: GetReleaseOptions['relations'] },
): Promise<ReleaseInChannel> {
  const channel = await fetchChannel(hotCodePush, options);
  const releaseId = await fetchReleaseId(hotCodePush, { channel, options });
  const release = await hotCodePush.apps.releases.get({
    appId: channel.appId,
    relations,
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
  {
    channel,
    relations,
  }: { channel: Channel; relations?: ListReleasesOptions['relations'] },
): Promise<Release[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.releases.list({
      appId: channel.appId,
      channelId: channel.id,
      relations,
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
  { flag, reference }: { flag: string; reference: string },
): Release {
  const release = isId(reference)
    ? releases.find(({ id }) => id === reference)
    : isNumber(reference)
      ? releases.find(({ number }) => number === Number(reference))
      : undefined;
  if (release === undefined) {
    throw new InvalidParameterError(
      `The channel has no release "${reference}" from ${flag}.`,
      { fix: `Name a release of the channel by number or id with ${flag}.` },
    );
  }
  return release;
}

// The materializer stamps `liveAt` once the index is written.
// Returns the last read release after the deadline, so the caller can say it is still pending.
export async function waitUntilLive(
  hotCodePush: HotCodePush,
  {
    appId,
    relations,
    releaseId,
  }: {
    appId: string;
    relations?: GetReleaseOptions['relations'];
    releaseId: string;
  },
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

async function fetchReleaseId(
  hotCodePush: HotCodePush,
  { channel, options }: { channel: Channel; options: ReleaseOptions },
): Promise<string> {
  if (options.release !== undefined && isId(options.release)) {
    return options.release;
  }
  const releases = await fetchReleaseLog(hotCodePush, {
    channel,
    relations: ['bundle'],
  });
  if (options.release !== undefined) {
    return resolveReleaseInLog(releases, {
      flag: '--release',
      reference: options.release,
    }).id;
  }
  return promptSelect(options, {
    choices: releases.map(release => ({
      label: `#${release.number} · ${resolveReleaseBundleLabel(release)} (${release.status})`,
      value: release.id,
    })),
    flag: '--release',
    message: 'Which release?',
  });
}
