import type {
  Audience,
  Channel,
  FleetStatistics,
  HotCodePush,
  Release,
} from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
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
  isReleaseServing,
  resolveReleaseBundleLabel,
  resolveReleaseInLog,
  waitUntilLive,
} from '../../resources/releases/fetch.js';
import { printCreatedRelease } from '../../resources/releases/output.js';
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
    "Release the release before the channel's newest active one again, or the one of --to-release, as a new release.",
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
      await fetchReleaseLog(hotCodePush, channel),
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
      // Without --to-release the API applies its own rule, which the preview above mirrors.
      toReleaseId:
        options.toRelease === undefined ? null : rollback.targetRelease.id,
      undoneRelease: rollback.undoneRelease,
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
    toReleaseId,
    undoneRelease,
  }: {
    channel: Channel;
    isMandatory: boolean;
    platform: Platform | null;
    toReleaseId: string | null;
    undoneRelease: Release;
  },
): Promise<Release> {
  const createdRelease = await hotCodePush.apps.channels.rollbacks
    .create({
      appId: channel.appId,
      channelId: channel.id,
      isMandatory,
      platform,
      toReleaseId,
    })
    .catch((error: unknown) => {
      throw isNoEarlierReleaseError(error)
        ? new NoEarlierReleaseError({
            channelName: channel.name,
            releaseNumber: undoneRelease.number,
          })
        : error;
    });
  return waitUntilLive(hotCodePush, {
    appId: channel.appId,
    relations: ['bundle'],
    releaseId: createdRelease.id,
  });
}

// The fleet counts the devices on the undone release, the target's audience those it reaches.
async function fetchRollbackConsequence(
  hotCodePush: HotCodePush,
  { channel, rollback }: { channel: Channel; rollback: Rollback },
): Promise<string> {
  const fleet = await hotCodePush.apps.statistics.fleet.get({
    appId: channel.appId,
    channelId: channel.id,
  });
  const targetReach = await fetchTargetReach(hotCodePush, {
    channel,
    targetRelease: rollback.targetRelease,
  });
  return resolveRollbackConsequence(rollback, {
    channel,
    strandedDeviceCount: resolveStrandedDeviceCount(rollback.undoneRelease, {
      fleet,
      targetReach,
    }),
    targetReach,
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

// A release published between the preview and the request can leave the API without a target.
function isNoEarlierReleaseError(error: unknown): boolean {
  if (!(error instanceof HotCodePushError) || error.code !== 'validation') {
    return false;
  }
  const details = error.details as { rule?: unknown } | null;
  return details?.rule === 'no_earlier_release';
}

// Mirrors the API: the newest earlier active release whose bundle serves every platform the undone one serves.
function resolvePreviousRelease(
  activeReleases: Release[],
  undoneRelease: Release,
): Release | undefined {
  const undonePlatforms = undoneRelease.bundle?.platforms ?? [];
  return activeReleases.find(
    release =>
      release.number < undoneRelease.number &&
      undonePlatforms.every(platform => isReleaseServing(release, platform)),
  );
}

function resolveReleaseText(release: Release): string {
  return release.bundle === undefined
    ? `#${release.number}`
    : `#${release.number} (${release.bundle.platforms.join(', ')} · ${release.bundle.version})`;
}

// The undone release is the newest active one, serving the platform when one is named.
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
  const activeReleases = releases
    .filter(({ status }) => status === 'active')
    .sort((left, right) => right.number - left.number);
  const undoneRelease = activeReleases.find(
    release => platform === null || isReleaseServing(release, platform),
  );
  if (undoneRelease === undefined) {
    throw new InvalidParameterError(
      `The channel ${channel.name} serves no active release${platform === null ? '' : ` on ${platform}`} to roll back.`,
    );
  }
  const targetRelease =
    toRelease === undefined
      ? resolvePreviousRelease(activeReleases, undoneRelease)
      : resolveReleaseInLog(releases, {
          flag: '--to-release',
          reference: toRelease,
        });
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
    strandedDeviceCount,
    targetReach,
  }: {
    channel: Channel;
    strandedDeviceCount: number | undefined;
    targetReach: TargetReach;
  },
): string {
  const rollbackText = `rolls ${channel.name} back from ${resolveReleaseText(rollback.undoneRelease)} to ${resolveReleaseText(rollback.targetRelease)}, reaching ${resolveCountText(targetReach.reachedDeviceCount)} of ${resolveCountText(targetReach.deviceCount)} devices`;
  return strandedDeviceCount === undefined
    ? rollbackText
    : `${rollbackText}. ${resolveStrandedText(rollback, { strandedDeviceCount, targetReach })}`;
}

// The devices on the undone release that the target cannot reach, such as a store build with another fingerprint.
function resolveStrandedDeviceCount(
  undoneRelease: Release,
  { fleet, targetReach }: { fleet: FleetStatistics; targetReach: TargetReach },
): number | undefined {
  const undoneDeviceCount = resolveReleaseDeviceCount(fleet, {
    releaseId: undoneRelease.id,
  });
  return targetReach.reachedDeviceCount < undoneDeviceCount
    ? undoneDeviceCount
    : undefined;
}

// The consequence ends without a full stop, since the confirmation adds it.
function resolveStrandedText(
  { targetRelease, undoneRelease }: Rollback,
  {
    strandedDeviceCount,
    targetReach,
  }: { strandedDeviceCount: number; targetReach: TargetReach },
): string {
  return `#${targetRelease.number} reaches ${resolveCountText(targetReach.reachedDeviceCount)} of the ${resolveCountText(strandedDeviceCount)} devices on #${undoneRelease.number}, whose store build carries another fingerprint. Revoke #${undoneRelease.number} to send them back to the store build's bundle`;
}
