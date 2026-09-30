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
  description:
    'Pause a channel, the kill switch: it serves nothing new until resumed.',
  examples: [
    'hotcodepush channel pause --channel production',
    'hotcodepush channel pause --channel production --yes --json',
  ],
  options: defineCommandOptions(channelOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedChannel = await fetchChannel(hotCodePush, options);
    const isConfirmed = await confirmConsequence(
      `pauses channel ${fetchedChannel.name}: devices keep what they have and get nothing new`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const pausedChannel = await hotCodePush.apps.channels.pause({
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
    });
    if (options.json) {
      printJson(pausedChannel);
    } else {
      console.log(
        `Paused channel ${pausedChannel.name} (${pausedChannel.id}).`,
      );
    }
  },
});
