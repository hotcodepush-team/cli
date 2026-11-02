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
    'Resume a paused release: devices get it again, and a new auto-pause window starts.',
  examples: [
    'hotcodepush release resume --release 43',
    'hotcodepush release resume --channel staging --release 43 --yes --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      `resumes release #${release.number} of ${channel.name}: devices get it again and a new auto-pause window starts`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const resumedRelease = await hotCodePush.apps.releases.resume({
      appId: channel.appId,
      releaseId: release.id,
    });
    if (options.json) {
      printJson(resumedRelease);
    } else {
      printResult({
        rows: [['ID', resumedRelease.id]],
        sentence: `Resumed release #${resumedRelease.number} of ${channel.name}.`,
      });
    }
  },
});
