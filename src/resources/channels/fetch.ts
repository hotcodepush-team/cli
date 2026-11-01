import type { Channel, HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../../config/consts.js';
import { fetchAllPages } from '../../utils/pagination.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import {
  readProjectConfig,
  resolveProjectChannel,
} from '../../utils/project-config.js';
import {
  fetchOrPromptResourceId,
  fetchResourceId,
} from '../../utils/resources.js';
import type { AppOptions } from '../apps.js';
import { fetchAppId } from '../apps.js';

export interface ChannelOptions extends AppOptions {
  channel?: string;
  config?: string;
}

export const channelOptionShape = {
  channel: z
    .string()
    .optional()
    .describe(
      "The channel, by id or name. Defaults to hotcodepush.json's channel.",
    ),
};

export async function fetchChannel(
  hotCodePush: HotCodePush,
  options: ChannelOptions,
): Promise<Channel> {
  const projectConfig = readProjectConfig(options.config);
  const appId = await fetchAppId(hotCodePush, options, projectConfig);
  const channelId = await fetchChannelId(
    hotCodePush,
    appId,
    options,
    projectConfig,
  );
  return hotCodePush.apps.channels.get({ appId, channelId });
}

// A list filtered by channel takes no default from hotcodepush.json, since no flag means every channel.
export async function fetchChannelFilterId(
  hotCodePush: HotCodePush,
  { appId, channel }: { appId: string; channel: string | undefined },
): Promise<string | undefined> {
  return channel === undefined
    ? undefined
    : fetchResourceId('channel', channel, () =>
        fetchChannels(hotCodePush, appId),
      );
}

// The channel of hotcodepush.json counts only when the app is the one of the file too.
export async function fetchChannelId(
  hotCodePush: HotCodePush,
  appId: string,
  options: ChannelOptions,
  projectConfig: ProjectConfig | undefined,
): Promise<string> {
  if (options.channel === undefined && projectConfig?.appId === appId) {
    return fetchResourceId(
      'channel',
      resolveProjectChannel(projectConfig),
      () => fetchChannels(hotCodePush, appId),
      PROJECT_CONFIG_FILE_NAME,
    );
  }
  return fetchOrPromptResourceId({
    fetchResources: () => fetchChannels(hotCodePush, appId),
    noun: 'channel',
    options,
    reference: options.channel,
  });
}

export function fetchChannels(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<Channel[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.channels.list({ appId, ...page }),
  );
}
