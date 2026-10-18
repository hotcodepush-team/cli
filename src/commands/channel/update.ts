import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  channelFieldsClearShape,
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
      console.log(
        `Updated channel ${updatedChannel.name} (${updatedChannel.id}).`,
      );
    }
  },
});
