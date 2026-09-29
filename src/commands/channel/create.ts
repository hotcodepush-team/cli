import type { Channel } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  channelFieldsShape,
  resolveChannelFields,
} from '../../utils/channel-fields.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';
import {
  fetchAppId,
  fetchChannels,
  resolveNamedResource,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const name =
      options.name ??
      (await promptText('--name', 'What is the channel called?', options));
    try {
      const createdChannel = await hotCodePush.apps.channels.create({
        ...resolveChannelFields(options),
        appId,
        name,
      });
      printChannel(createdChannel, 'Created channel', options.json);
    } catch (error) {
      if (!options.ifNotExists || !isChannelNameTaken(error)) {
        throw error;
      }
      printChannel(
        resolveNamedResource(
          'channel',
          name,
          await fetchChannels(hotCodePush, appId),
        ),
        'Found the existing channel',
        options.json,
      );
    }
  },
  description:
    'Create a channel in an app, with an expiry for a preview channel and its auto-pause policy.',
  examples: [
    'hotcodepush channel create --name staging --protected',
    'hotcodepush channel create --name pr-42 --expires-in 14d --if-not-exists --json',
  ],
  options: defineCommandOptions({
    ...channelFieldsShape,
    ifNotExists: z
      .boolean()
      .optional()
      .describe(
        'Return the channel of that name when it exists instead of failing, for re-run pipelines.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'The name: letters, digits, - and _, one to 64 characters, unique in the app.',
      ),
  }),
});

function isChannelNameTaken(error: unknown): boolean {
  return (
    error instanceof HotCodePushError && error.code === 'E_CHANNEL_NAME_TAKEN'
  );
}

function printChannel(
  channel: Channel,
  sentencePrefix: string,
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson(channel);
  } else {
    console.log(`${sentencePrefix} ${channel.name} (${channel.id}).`);
  }
}
