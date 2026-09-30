import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  description: 'Resume a paused channel: it serves its releases again.',
  examples: [
    'hotcodepush channel resume --channel production',
    'hotcodepush channel resume --channel production --yes --json',
  ],
  options: defineCommandOptions(channelOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedChannel = await fetchChannel(hotCodePush, options);
    const isConfirmed = await confirmConsequence(
      `resumes channel ${fetchedChannel.name}: devices receive its releases again`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const resumedChannel = await hotCodePush.apps.channels.resume({
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
    });
    if (options.json) {
      printJson(resumedChannel);
    } else {
      console.log(
        `Resumed channel ${resumedChannel.name} (${resumedChannel.id}).`,
      );
    }
  },
});
