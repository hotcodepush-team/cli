import type { HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { UnknownNameError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import type { ChannelOptions } from '../../utils/resource-resolution.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

const ID_SCHEMA = z.guid();

export default defineCommand({
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
        console.log('The channel does not exist; nothing to delete.');
      }
    }
  },
  description:
    'Delete a channel and its releases; devices on it keep what they have.',
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
  await hotCodePush.apps.channels.delete({
    appId: fetchedChannel.appId,
    channelId: fetchedChannel.id,
  });
  if (options.json) {
    printJson({ id: fetchedChannel.id, name: fetchedChannel.name });
  } else {
    console.log(
      `Deleted channel ${fetchedChannel.name} (${fetchedChannel.id}).`,
    );
  }
}

/**
 * A channel no name matches or the API does not know, the app's included: a gone app has no channels.
 */
function isChannelGone(error: unknown): boolean {
  return (
    error instanceof UnknownNameError ||
    (error instanceof HotCodePushError && error.code === 'E_NOT_FOUND')
  );
}

/**
 * What did not go, as it was named: an id or a name, the other side null.
 */
function resolveAbsentChannel(channel: string | undefined): {
  id: string | null;
  name: string | null;
} {
  return channel !== undefined && ID_SCHEMA.safeParse(channel).success
    ? { id: channel, name: null }
    : { id: null, name: channel ?? null };
}
