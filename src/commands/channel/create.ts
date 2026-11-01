import type { Channel } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import { fetchChannels } from '../../resources/channels/fetch.js';
import {
  channelFieldsShape,
  resolveChannelFields,
} from '../../resources/channels/fields.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';
import { resolveNamedResource } from '../../utils/resources.js';

export default defineCommand({
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
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(hotCodePush, {
      options,
      projectConfig: readProjectConfig(options.config),
    });
    const name =
      options.name ??
      (await promptText(options, {
        flag: '--name',
        message: 'What is the channel called?',
      }));
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
        resolveNamedResource(await fetchChannels(hotCodePush, appId), {
          name,
          noun: 'channel',
        }),
        'Found the existing channel',
        options.json,
      );
    }
  },
});

function isChannelNameTaken(error: unknown): boolean {
  return (
    error instanceof HotCodePushError && error.code === 'channel_name_taken'
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
