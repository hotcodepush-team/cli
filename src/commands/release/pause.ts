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
      `pauses release #${release.number} of ${channel.name}: devices on it keep it and no new device gets it`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const pausedRelease = await hotCodePush.apps.releases.pause({
      appId: release.appId,
      releaseId: release.id,
    });
    if (options.json) {
      printJson(pausedRelease);
    } else {
      console.log(
        `Paused release #${pausedRelease.number} of ${channel.name} (${pausedRelease.id}).`,
      );
    }
  },
  description:
    'Pause a release: devices on it keep it, and nobody new gets it until it is resumed.',
  examples: [
    'hotcodepush release pause --release 43',
    'hotcodepush release pause --channel staging --release 43 --yes --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
  }),
});
