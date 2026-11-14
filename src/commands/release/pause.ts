import { channelOptionShape } from '../../resources/channels/fetch.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../resources/releases/fetch.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
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
  action: async options => {
    const hotCodePush = createApiClient();
    const { channel, release } = await fetchReleaseInChannel(hotCodePush, {
      options,
      relations: [],
    });
    const isConfirmed = await confirmConsequence(
      `pauses release #${release.number} of ${channel.name}: devices on it keep it and no new device gets it`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const pausedRelease = await hotCodePush.apps.releases.pause({
      appId: channel.appId,
      releaseId: release.id,
    });
    if (options.json) {
      printJson(pausedRelease);
    } else {
      printResult({
        rows: [['ID', pausedRelease.id]],
        sentence: `Paused release #${pausedRelease.number} of ${channel.name}.`,
      });
    }
  },
});
