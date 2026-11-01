import type { Channel, HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import type { ChannelOptions } from '../../resources/channel/fetch.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../resources/channel/fetch.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { UnknownNameError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, resolveQuantityText } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { isId } from '../../utils/reference.js';

export default defineCommand({
  description:
    'Delete a channel and its releases. Devices on it keep what they have.',
  examples: [
    'hotcodepush channel delete --channel staging',
    'hotcodepush channel delete --channel pr-42 --ignore-not-found --yes --json',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ignoreNotFound: z
      .boolean()
      .optional()
      .describe(
        'Succeed when the channel does not exist, for re-run pipelines.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    try {
      await deleteChannel(hotCodePush, options);
    } catch (error) {
      if (!options.ignoreNotFound || !isChannelGone(error)) {
        throw error;
      }
      if (options.json) {
        printJson(resolveAbsentChannel(options.channel));
      } else {
        console.log('The channel does not exist. There is nothing to delete.');
      }
    }
  },
});

async function deleteChannel(
  hotCodePush: HotCodePush,
  options: ChannelOptions,
): Promise<void> {
  const fetchedChannel = await fetchChannel(hotCodePush, options);
  const isConfirmed = await confirmConsequence(
    `deletes channel ${fetchedChannel.name} and its releases: devices on it keep what they have`,
    options,
  );
  if (!isConfirmed) {
    return;
  }
  // The count is a reader's figure, so `--json` neither asks for it nor prints it.
  const deviceCount = options.json
    ? null
    : await fetchChannelDeviceCount(hotCodePush, fetchedChannel);
  await hotCodePush.apps.channels.delete({
    appId: fetchedChannel.appId,
    channelId: fetchedChannel.id,
  });
  if (options.json) {
    printJson({ id: fetchedChannel.id, name: fetchedChannel.name });
  } else {
    console.log(resolveDeletedChannelText(fetchedChannel, { deviceCount }));
  }
}

async function fetchChannelDeviceCount(
  hotCodePush: HotCodePush,
  channel: Channel,
): Promise<number | null> {
  try {
    const { count } = await hotCodePush.apps.devices.count({
      appId: channel.appId,
      channelId: channel.id,
    });
    return count;
  } catch {
    // The count only informs the result line, so it never stops the delete.
    return null;
  }
}

function resolveDeletedChannelText(
  channel: Channel,
  { deviceCount }: { deviceCount: number | null },
): string {
  const deletedText = `Deleted channel ${channel.name} (${channel.id}).`;
  if (deviceCount === null || deviceCount === 0) {
    return deletedText;
  }
  const verb = deviceCount === 1 ? 'was' : 'were';
  return `${deletedText} ${resolveQuantityText(deviceCount, 'device')} ${verb} on it.`;
}

// A deleted app has no channels either.
function isChannelGone(error: unknown): boolean {
  return (
    error instanceof UnknownNameError ||
    (error instanceof HotCodePushError && error.code === 'not_found')
  );
}

function resolveAbsentChannel(channel: string | undefined): {
  id: string | null;
  name: string | null;
} {
  return channel !== undefined && isId(channel)
    ? { id: channel, name: null }
    : { id: null, name: channel ?? null };
}
