import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchReleaseInChannel,
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
    const isConfirmed = await confirmConsequence(
      `revokes release #${release.number} of ${channel.name} for good: devices on it move to the newest older release they qualify for or the embedded bundle`,
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
