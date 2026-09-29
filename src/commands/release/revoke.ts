import type { Release } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, resolveQuantityText } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchReleaseInChannel,
  fetchReleaseLog,
  releaseOptionShape,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const targetRelease = resolveFallbackRelease(
      await fetchReleaseLog(hotCodePush, channel),
      release,
    );
    const isConfirmed = await confirmConsequence(
      `revokes release #${release.number} of ${channel.name} for good: ${resolveQuantityText(release.deviceCount, 'device')} on it ${release.deviceCount === 1 ? 'moves' : 'move'} to ${targetRelease === undefined ? 'the embedded bundle' : `release #${targetRelease.number}`}`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const revokedRelease = await hotCodePush.apps.releases.revoke({
      appId: release.appId,
      releaseId: release.id,
    });
    if (options.json) {
      printJson(revokedRelease);
    } else {
      console.log(
        `Revoked release #${revokedRelease.number} of ${channel.name} (${revokedRelease.id}).`,
      );
    }
  },
  description:
    'Revoke a release for good: devices on it move to the newest older release they qualify for or the embedded bundle.',
  examples: [
    'hotcodepush release revoke --release 43',
    'hotcodepush release revoke --channel staging --release 43 --yes --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
  }),
});

/**
 * Where the devices go: the newest active release older than the revoked one, as the API moves them; none is the embedded bundle.
 */
function resolveFallbackRelease(
  releases: Release[],
  revokedRelease: Release,
): Release | undefined {
  return releases
    .filter(
      ({ number, state }) =>
        state === 'active' && number < revokedRelease.number,
    )
    .sort((left, right) => right.number - left.number)[0];
}
