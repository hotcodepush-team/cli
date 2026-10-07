import type { Channel, HotCodePush, Release } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { fetchBundle } from '../../utils/bundle-resolution.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, resolveQuantityText } from '../../utils/output.js';
import { fetchAllPages } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import type { ReleaseOptions } from '../../utils/release-resolution.js';
import {
  fetchReleaseInChannel,
  fetchReleaseLog,
  releaseOptionShape,
} from '../../utils/release-resolution.js';
import {
  channelOptionShape,
  fetchAppId,
  fetchChannel,
} from '../../utils/resource-resolution.js';

/**
 * The most ids the bulk route takes in one request.
 */
const MAX_RELEASE_IDS_PER_REVOCATION = 100;

/**
 * What one channel loses: the releases revoked, newest first, beside the channel's whole log they move devices along,
 * and the request that revokes them.
 */
interface ChannelRevocation {
  channel: Channel;
  releaseLog: Release[];
  request: RevocationRequest;
  revokedReleases: Release[];
}

/**
 * Where a revoked release's devices go: the newest active older release left, or the embedded bundle when none is.
 */
interface DeviceMove {
  deviceCount: number;
  targetRelease: Release | undefined;
}

interface ReleaseRevokeOptions extends ReleaseOptions {
  all?: boolean;
  bundle?: string;
  releaseFrom?: number;
}

/**
 * The single route for `--release`, the bulk route for every other form with the ids of the releases confirmed,
 * newest first, so a release published after the confirmation is never revoked unseen.
 */
type RevocationRequest = { releaseId: string } | { releaseIds: string[] };

export default defineCommand({
  description:
    'Revoke releases for good: devices on them move to the newest older release they qualify for or the embedded bundle.',
  examples: [
    'hotcodepush release revoke --release 43',
    'hotcodepush release revoke --channel staging --release-from 40 --yes --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
    all: z
      .boolean()
      .optional()
      .describe(
        'Every release of the channel; its devices return to the embedded bundle.',
      ),
    bundle: z
      .string()
      .optional()
      .describe(
        "Every release of this bundle, by number or id, across the app's channels; without --channel.",
      ),
    releaseFrom: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'The first release revoked, by number, inclusive: that one and every newer one of the channel.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const revocations = await fetchRevocations(hotCodePush, options);
    if (
      revocations.every(({ revokedReleases }) => revokedReleases.length === 0)
    ) {
      printNothingToRevoke(options.json);
      return;
    }
    for (const pausedText of resolvePausedLandingTexts(revocations)) {
      process.stderr.write(`Warning: ${pausedText}\n`);
    }
    const isConfirmed = await confirmConsequence(
      resolveRevocationConsequence(revocations),
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const answers: { channel: Channel; releases: Release[] }[] = [];
    for (const { channel, request } of revocations) {
      answers.push({
        channel,
        releases: await fetchRevocation(hotCodePush, channel, request),
      });
    }
    if (options.json) {
      const isSingleRelease = revocations.some(
        ({ request }) => 'releaseId' in request,
      );
      printJson(
        isSingleRelease
          ? answers[0]?.releases[0]
          : answers.flatMap(({ releases }) => releases),
      );
      return;
    }
    for (const { channel, releases } of answers) {
      console.log(
        `Revoked ${resolveReleasesText(releases)} of ${channel.name}${releases.length === 1 ? ` (${releases[0]?.id})` : ''}.`,
      );
    }
  },
});

/**
 * Sends one channel's revocation: the single route answers the release, the bulk route the releases it names,
 * newest first.
 */
async function fetchRevocation(
  hotCodePush: HotCodePush,
  channel: Channel,
  request: RevocationRequest,
): Promise<Release[]> {
  if ('releaseId' in request) {
    return [
      await hotCodePush.apps.releases.revoke({
        appId: channel.appId,
        releaseId: request.releaseId,
      }),
    ];
  }
  const revokedReleases: Release[] = [];
  for (const releaseIds of resolveReleaseIdPages(request.releaseIds)) {
    revokedReleases.push(
      ...(await hotCodePush.apps.channels.releases.revoke({
        appId: channel.appId,
        channelId: channel.id,
        releaseIds,
      })),
    );
  }
  return revokedReleases.sort((left, right) => right.number - left.number);
}

/**
 * What the flags revoke, one channel's releases or, for `--bundle`, the bundle's releases in every channel serving it.
 */
async function fetchRevocations(
  hotCodePush: HotCodePush,
  options: ReleaseRevokeOptions,
): Promise<ChannelRevocation[]> {
  const formFlags = [
    options.all ? '--all' : undefined,
    options.bundle === undefined ? undefined : '--bundle',
    options.release === undefined ? undefined : '--release',
    options.releaseFrom === undefined ? undefined : '--release-from',
  ].filter(flag => flag !== undefined);
  if (formFlags.length > 1) {
    throw new InvalidParameterError(
      `${formFlags.join(' and ')}: pass one of them`,
      undefined,
    );
  }
  if (options.bundle !== undefined) {
    if (options.channel !== undefined) {
      throw new InvalidParameterError(
        "--bundle and --channel: --bundle revokes the bundle's releases in every channel; pass it alone",
        undefined,
      );
    }
    return fetchBundleRevocations(hotCodePush, options);
  }
  if (options.all || options.releaseFrom !== undefined) {
    const fromNumber = options.releaseFrom ?? 1;
    const channel = await fetchChannel(hotCodePush, options);
    const releaseLog = await fetchReleaseLog(hotCodePush, channel);
    const revokedReleases = releaseLog.filter(
      ({ number, state }) => number >= fromNumber && state !== 'revoked',
    );
    return [
      {
        channel,
        releaseLog,
        request: { releaseIds: revokedReleases.map(({ id }) => id) },
        revokedReleases,
      },
    ];
  }
  const { channel, release } = await fetchReleaseInChannel(
    hotCodePush,
    options,
  );
  return [
    {
      channel,
      releaseLog: await fetchReleaseLog(hotCodePush, channel),
      request: { releaseId: release.id },
      revokedReleases: [release],
    },
  ];
}

/**
 * Every release of the bundle `--bundle` names that is not revoked yet, grouped by the channel serving it.
 */
async function fetchBundleRevocations(
  hotCodePush: HotCodePush,
  options: ReleaseRevokeOptions,
): Promise<ChannelRevocation[]> {
  const appId = await fetchAppId(
    hotCodePush,
    options,
    readProjectConfig(options.config),
  );
  const bundle = await fetchBundle(hotCodePush, appId, options);
  const pendingReleases = (
    await fetchAllPages(page =>
      hotCodePush.apps.releases.list({
        appId,
        bundleId: bundle.id,
        relations: ['bundle', 'channel'],
        ...page,
      }),
    )
  ).filter(({ state }) => state !== 'revoked');
  const channels = new Map<string, Channel>();
  for (const { channel } of pendingReleases) {
    if (channel !== undefined) {
      channels.set(channel.id, channel);
    }
  }
  return Promise.all(
    [...channels.values()].map(async channel => {
      const revokedReleases = pendingReleases.filter(
        ({ channelId }) => channelId === channel.id,
      );
      return {
        channel,
        releaseLog: await fetchReleaseLog(hotCodePush, channel),
        request: { releaseIds: revokedReleases.map(({ id }) => id) },
        revokedReleases,
      };
    }),
  );
}

function printNothingToRevoke(isJson: boolean | undefined): void {
  if (isJson) {
    printJson([]);
    return;
  }
  console.log('Nothing to revoke: no release named is active or paused.');
}

/**
 * Where each revoked release's devices go, as the API moves them: the newest active release older than it that is not
 * revoked with it, or the embedded bundle; the devices summed per destination, the releases with none left out.
 */
function resolveDeviceMoves(revocation: ChannelRevocation): DeviceMove[] {
  const moves = new Map<string, DeviceMove>();
  for (const revokedRelease of revocation.revokedReleases) {
    if (revokedRelease.deviceCount === 0) {
      continue;
    }
    const targetRelease = resolveOlderReleases(revocation, revokedRelease).find(
      ({ state }) => state === 'active',
    );
    const key = targetRelease?.id ?? 'embedded';
    const move = moves.get(key) ?? { deviceCount: 0, targetRelease };
    move.deviceCount += revokedRelease.deviceCount;
    moves.set(key, move);
  }
  return [...moves.values()];
}

function resolveMovesText(
  revocation: ChannelRevocation,
  isChannelNamed: boolean,
): string | undefined {
  const moves = resolveDeviceMoves(revocation);
  if (moves.length === 0) {
    return undefined;
  }
  const channelText = isChannelNamed ? ` in ${revocation.channel.name}` : '';
  return moves
    .map(({ deviceCount, targetRelease }) => {
      const devicesText = resolveQuantityText(deviceCount, 'device');
      return targetRelease === undefined
        ? `${devicesText} return to the embedded bundle${channelText}`
        : `${devicesText} move to release #${targetRelease.number}${channelText}`;
    })
    .join(' and ');
}

/**
 * The releases older than the revoked one that stay, newest first: where its devices may land.
 */
function resolveOlderReleases(
  revocation: ChannelRevocation,
  revokedRelease: Release,
): Release[] {
  const revokedReleaseIds = new Set(
    revocation.revokedReleases.map(({ id }) => id),
  );
  return revocation.releaseLog
    .filter(
      ({ id, number, state }) =>
        number < revokedRelease.number &&
        state !== 'revoked' &&
        !revokedReleaseIds.has(id),
    )
    .sort((left, right) => right.number - left.number);
}

/**
 * The release a revoked release's devices would land on when it is paused: a paused release takes no device,
 * so they land one further back.
 */
function resolvePausedLandingTexts(revocations: ChannelRevocation[]): string[] {
  const texts = new Set<string>();
  for (const revocation of revocations) {
    for (const revokedRelease of revocation.revokedReleases) {
      const [landingRelease] = resolveOlderReleases(revocation, revokedRelease);
      if (
        revokedRelease.deviceCount > 0 &&
        landingRelease?.state === 'paused'
      ) {
        texts.add(
          `release #${landingRelease.number} of ${revocation.channel.name} is paused, so the devices that would land on it land one further back`,
        );
      }
    }
  }
  return [...texts];
}

/**
 * How many releases go where and how many devices move where, that revoked is final, and how a bundle comes back.
 */
function resolveRevocationConsequence(
  revocations: ChannelRevocation[],
): string {
  const isChannelNamed = revocations.length > 1;
  const releasesText = revocations
    .map(
      ({ channel, revokedReleases }) =>
        `${resolveReleasesText(revokedReleases)} of ${channel.name}`,
    )
    .join(' and ');
  const movesText =
    revocations
      .map(revocation => resolveMovesText(revocation, isChannelNamed))
      .filter(text => text !== undefined)
      .join('; ') || 'no device runs them';
  const bundleNumbers = new Set(
    revocations.flatMap(({ revokedReleases }) =>
      revokedReleases.map(({ bundle }) => bundle?.number),
    ),
  );
  const [bundleNumber] = bundleNumbers;
  const reReleaseText =
    bundleNumbers.size === 1 && bundleNumber !== undefined
      ? `"release create --bundle ${bundleNumber}" releases its bundle again`
      : '"release create --bundle <number>" releases a bundle again';
  return `revokes ${releasesText} for good: ${movesText}; revoked is final, and ${reReleaseText}`;
}

/**
 * The ids of releases listed newest first, in the pages the bulk route takes, the oldest page sent first:
 * a page's devices then land past every older release, never on a newer one the next page revokes.
 */
function resolveReleaseIdPages(newestFirstReleaseIds: string[]): string[][] {
  const oldestFirstReleaseIds = newestFirstReleaseIds.toReversed();
  const pages: string[][] = [];
  for (
    let start = 0;
    start < oldestFirstReleaseIds.length;
    start += MAX_RELEASE_IDS_PER_REVOCATION
  ) {
    pages.push(
      oldestFirstReleaseIds.slice(
        start,
        start + MAX_RELEASE_IDS_PER_REVOCATION,
      ),
    );
  }
  return pages;
}

/**
 * The releases by number when they are few, `release #43`, `releases #45, #44 and #43`, else counted, `14 releases`.
 */
function resolveReleasesText(releases: Release[]): string {
  const numberTexts = releases.map(({ number }) => `#${number}`);
  if (numberTexts.length === 1) {
    return `release ${numberTexts[0]}`;
  }
  if (numberTexts.length > 3) {
    return resolveQuantityText(numberTexts.length, 'release');
  }
  return `releases ${numberTexts.slice(0, -1).join(', ')} and ${numberTexts.at(-1)}`;
}
