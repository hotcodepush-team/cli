import { z } from 'zod';
import {
  channelOptionShape,
  fetchChannel,
} from '../../resources/channels/fetch.js';
import {
  channelFieldsClearShape,
  channelFieldsShape,
  resolveChannelFields,
} from '../../resources/channels/fields.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';

export default defineCommand({
  description:
    'Rename a channel or change its flags, expiry and auto-pause policy.',
  examples: [
    'hotcodepush channel update --channel staging --protected',
    'hotcodepush channel update --channel pr-42 --expires-in 7d --json',
  ],
  options: defineCommandOptions({
    ...channelFieldsClearShape,
    ...channelFieldsShape,
    ...channelOptionShape,
    name: z
      .string()
      .optional()
      .describe(
        "The channel's new name: letters, digits, - and _, one to 64 characters.",
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const channelFields = resolveChannelFields(options);
    const fetchedChannel = await fetchChannel(hotCodePush, options);
    const updatedChannel = await hotCodePush.apps.channels.update({
      ...channelFields,
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
      name: options.name,
    });
    if (options.json) {
      printJson(updatedChannel);
    } else {
      printResult({
        rows: [['ID', updatedChannel.id]],
        sentence: `Updated channel ${updatedChannel.name}.`,
      });
    }
  },
});
