import type { Release } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { printReleasedLine } from '../../utils/release-output.js';
import {
  fetchReleaseLog,
  resolveReleaseBundleLabel,
  resolveReleaseInLog,
  waitUntilLive,
} from '../../utils/release-resolution.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedChannel = await fetchChannel(hotCodePush, options);
    const releases = await fetchReleaseLog(hotCodePush, fetchedChannel);
    const targetRelease =
      options.toRelease === undefined
        ? resolvePreviousRelease(releases)
        : resolveReleaseInLog(releases, options.toRelease, '--to-release');
    const bundleLabel = resolveReleaseBundleLabel(targetRelease);
    const isConfirmed = await confirmConsequence(
      `rolls channel ${fetchedChannel.name} back to bundle ${bundleLabel} of release #${targetRelease.number} as a new release, reaching its ${fetchedChannel.activeDeviceCount} active devices`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const createdRelease = await hotCodePush.apps.channels.rollbacks.create({
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
      toReleaseId: targetRelease.id,
    });
    const liveRelease = await waitUntilLive(hotCodePush, createdRelease);
    if (options.json) {
      printJson(liveRelease);
    } else {
      printReleasedLine(liveRelease, fetchedChannel.name, bundleLabel);
    }
  },
  description:
    "Release the channel's previous bundle again, or the one of --to-release, as a new release.",
  examples: [
    'hotcodepush release rollback',
    'hotcodepush release rollback --channel staging --to-release 41 --yes',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    toRelease: z
      .string()
      .optional()
      .describe(
        "The release whose bundle comes back, by number or id; the channel's previous one by default.",
      ),
  }),
});

/**
 * The API's own rule for a rollback without a target: the newest active release below the current one whose bundle differs.
 */
function resolvePreviousRelease(releases: Release[]): Release {
  const activeReleases = releases
    .filter(({ state }) => state === 'active')
    .sort((left, right) => right.number - left.number);
  const currentRelease = activeReleases[0];
  const previousRelease = activeReleases.find(
    release =>
      currentRelease !== undefined &&
      release.number < currentRelease.number &&
      release.bundleId !== currentRelease.bundleId,
  );
  if (previousRelease === undefined) {
    throw new InvalidParameterError(
      '--to-release: the channel has no earlier release to roll back to; name one',
      undefined,
    );
  }
  return previousRelease;
}
