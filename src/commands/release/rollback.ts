import type {
  Audience,
  Channel,
  HotCodePush,
  Release,
} from '@hotcodepush/node';
import { z } from 'zod';
import {
  fetchPlatform,
  platformOptionShape,
} from '../../frameworks/platform.js';
import { resolveCountText } from '../../resources/audience.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../resources/channels/fetch.js';
import {
  fetchReleaseLog,
  resolveReleaseBundleLabel,
  resolveReleaseInLog,
  waitUntilLive,
} from '../../resources/releases/fetch.js';
import { printCreatedRelease } from '../../resources/releases/output.js';
import {
  findNewestActiveRelease,
  isReleaseServing,
} from '../../resources/releases/serving.js';
import { resolveReleaseDeviceCount } from '../../resources/statistics.js';
import type { Platform } from '../../upload/upload.js';
import { createApiClient } from '../../utils/api-client.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import { defineCommand } from '../../utils/command.js';
import {
  InvalidParameterError,
  NoEarlierReleaseError,
} from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

interface Rollback {
  targetRelease: Release;
  undoneRelease: Release;
}

type TargetReach = Pick<Audience, 'deviceCount' | 'reachedDeviceCount'>;

export default defineCommand({
  description:
    'Roll the channel back to the release before its newest active one, or to --to-release, as a new release.',
  examples: [
    'hotcodepush release rollback',
    'hotcodepush release rollback --channel staging --platform ios --to-release 41 --yes',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    mandatory: booleanFlagSchema
      .optional()
      .describe(
        'Devices apply the rollback at once and restart, the default for an incident fix. Pass false to let them wait.',
      ),
    platform: platformOptionShape.platform.describe(
      'The platform whose newest release is rolled back, ios or android. Required on React Native and Expo, where a bundle serves one platform.',
    ),
    toRelease: z
      .string()
      .optional()
      .describe(
        'The release whose bundle comes back, by number or id. Defaults to the one before the newest active release.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const channel = await fetchChannel(hotCodePush, options);
    const platform = await fetchPlatform(hotCodePush, {
      appId: channel.appId,
      options,
    });
    const rollback = resolveRollback(
      await fetchReleaseLog(hotCodePush, { channel, relations: ['bundle'] }),
      { channel, platform, toRelease: options.toRelease },
    );
    const isConfirmed = await confirmConsequence(
      await fetchRollbackConsequence(hotCodePush, { channel, rollback }),
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const liveRelease = await createLiveRollback(hotCodePush, {
      channel,
      isMandatory: options.mandatory ?? true,
      platform,
      targetRelease: rollback.targetRelease,
    });
    if (options.json) {
      printJson(liveRelease);
    } else {
      printCreatedRelease(liveRelease, {
        bundleLabel: resolveReleaseBundleLabel(liveRelease),
        channelName: channel.name,
      });
    }
  },
});

async function createLiveRollback(
  hotCodePush: HotCodePush,
  {
    channel,
    isMandatory,
    platform,
    targetRelease,
  }: {
    channel: Channel;
    isMandatory: boolean;
    platform: Platform | null;
    targetRelease: Release;
  },
): Promise<Release> {
  const createdRelease = await hotCodePush.apps.channels.rollbacks.create({
    appId: channel.appId,
    channelId: channel.id,
    isMandatory,
    platform,
    toReleaseId: targetRelease.id,
  });
  return waitUntilLive(hotCodePush, {
    appId: channel.appId,
    relations: ['bundle'],
    releaseId: createdRelease.id,
  });
}

// A store build takes only a bundle of its own fingerprint, so another fingerprint strands every device on the undone release.
async function fetchRollbackConsequence(
  hotCodePush: HotCodePush,
  { channel, rollback }: { channel: Channel; rollback: Rollback },
): Promise<string> {
  const targetReach = await fetchTargetReach(hotCodePush, {
    channel,
    targetRelease: rollback.targetRelease,
  });
  const undoneDeviceCount = isFingerprintKept(rollback)
    ? undefined
    : await fetchUndoneDeviceCount(hotCodePush, {
        channel,
        undoneRelease: rollback.undoneRelease,
      });
  return resolveRollbackConsequence(rollback, {
    channel,
    targetReach,
    undoneDeviceCount,
  });
}

function fetchTargetReach(
  hotCodePush: HotCodePush,
  { channel, targetRelease }: { channel: Channel; targetRelease: Release },
): Promise<TargetReach> {
  return hotCodePush.apps.releases.audience.get({
    appId: channel.appId,
    releaseId: targetRelease.id,
  });
}

async function fetchUndoneDeviceCount(
  hotCodePush: HotCodePush,
  { channel, undoneRelease }: { channel: Channel; undoneRelease: Release },
): Promise<number> {
  const fleet = await hotCodePush.apps.statistics.fleet.get({
    appId: channel.appId,
    channelId: channel.id,
  });
  return resolveReleaseDeviceCount(fleet, { releaseId: undoneRelease.id });
}

function isFingerprintKept({
  targetRelease,
  undoneRelease,
}: Rollback): boolean {
  return (
    targetRelease.bundle?.fingerprint === undoneRelease.bundle?.fingerprint
  );
}

// Mirrors the API: the newest earlier active release whose bundle serves every platform the undone one serves.
function resolvePreviousRelease(
  releases: Release[],
  undoneRelease: Release,
): Release | undefined {
  const undonePlatforms = undoneRelease.bundle?.platforms ?? [];
  const earlierReleases = releases.filter(
    release =>
      release.number < undoneRelease.number &&
      undonePlatforms.every(platform => isReleaseServing(release, platform)),
  );
  return findNewestActiveRelease(earlierReleases, { platform: null });
}

function resolveReleaseText(release: Release): string {
  return release.bundle === undefined
    ? `#${release.number}`
    : `#${release.number} (${release.bundle.platforms.join(', ')} · ${release.bundle.version})`;
}

function resolveRollback(
  releases: Release[],
  {
    channel,
    platform,
    toRelease,
  }: {
    channel: Channel;
    platform: Platform | null;
    toRelease: string | undefined;
  },
): Rollback {
  const undoneRelease = findNewestActiveRelease(releases, { platform });
  if (undoneRelease === undefined) {
    throw new InvalidParameterError(
      `The channel ${channel.name} serves no active release${platform === null ? '' : ` on ${platform}`} to roll back.`,
      { fix: 'Release a bundle to the channel first with release create.' },
    );
  }
  const targetRelease =
    toRelease === undefined
      ? resolvePreviousRelease(releases, undoneRelease)
      : resolveTargetRelease(releases, { platform, toRelease });
  if (targetRelease === undefined) {
    throw new NoEarlierReleaseError({
      channelName: channel.name,
      releaseNumber: undoneRelease.number,
    });
  }
  return { targetRelease, undoneRelease };
}

function resolveRollbackConsequence(
  rollback: Rollback,
  {
    channel,
    targetReach,
    undoneDeviceCount,
  }: {
    channel: Channel;
    targetReach: TargetReach;
    undoneDeviceCount: number | undefined;
  },
): string {
  const rollbackText = `rolls ${channel.name} back from ${resolveReleaseText(rollback.undoneRelease)} to ${resolveReleaseText(rollback.targetRelease)}, reaching ${resolveCountText(targetReach.reachedDeviceCount)} of ${resolveCountText(targetReach.deviceCount)} devices`;
  return undoneDeviceCount === undefined
    ? rollbackText
    : `${rollbackText}. ${resolveStrandedText(rollback, { undoneDeviceCount })}`;
}

// The consequence ends without a full stop, since the confirmation adds it.
function resolveStrandedText(
  { targetRelease, undoneRelease }: Rollback,
  { undoneDeviceCount }: { undoneDeviceCount: number },
): string {
  return `#${targetRelease.number} reaches none of the ${resolveCountText(undoneDeviceCount)} devices on #${undoneRelease.number}, whose store build carries another fingerprint. Revoke #${undoneRelease.number} to send them back to the store build's bundle`;
}

function resolveTargetRelease(
  releases: Release[],
  { platform, toRelease }: { platform: Platform | null; toRelease: string },
): Release {
  const targetRelease = resolveReleaseInLog(releases, {
    flag: '--to-release',
    reference: toRelease,
  });
  if (platform !== null && !isReleaseServing(targetRelease, platform)) {
    throw new InvalidParameterError(
      `The bundle of release #${targetRelease.number} from --to-release does not serve ${platform}.`,
      {
        fix: `Name a release whose bundle serves ${platform} with --to-release.`,
      },
    );
  }
  return targetRelease;
}
