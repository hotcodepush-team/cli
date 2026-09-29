import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  channelFieldsShape,
  resolveChannelFields,
} from '../../utils/channel-fields.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedChannel = await fetchChannel(hotCodePush, options);
    const updatedChannel = await hotCodePush.apps.channels.update({
      ...resolveChannelFields(options),
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
      name: options.name,
    });
    if (options.json) {
      printJson(updatedChannel);
    } else {
      console.log(
        `Updated channel ${updatedChannel.name} (${updatedChannel.id}).`,
      );
    }
  },
  description:
    'Rename a channel or change its flags, expiry and auto-pause policy.',
  examples: [
    'hotcodepush channel update --channel staging --protected',
    'hotcodepush channel update --channel pr-42 --expires-in 7d --json',
  ],
  options: defineCommandOptions({
    ...channelFieldsShape,
    ...channelOptionShape,
    name: z
      .string()
      .optional()
      .describe(
        "The channel's new name: letters, digits, - and _, one to 64 characters.",
      ),
  }),
});
