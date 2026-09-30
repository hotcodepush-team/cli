import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

const DEFAULT_POLICY_TEXT = 'the default';

export default defineCommand({
  description:
    "Print a channel with its device counts, hotcodepush.json's by default.",
  examples: [
    'hotcodepush channel get',
    'hotcodepush channel get --channel staging --json',
  ],
  options: defineCommandOptions(channelOptionShape),
  action: async options => {
    const fetchedChannel = await fetchChannel(createApiClient(), options);
    if (options.json) {
      printJson(fetchedChannel);
      return;
    }
    printDetails([
      ['ID', fetchedChannel.id],
      ['Name', fetchedChannel.name],
      [
        'State',
        fetchedChannel.pausedAt === null
          ? 'running'
          : `paused since ${fetchedChannel.pausedAt}`,
      ],
      ['Protected', fetchedChannel.isProtected ? 'yes' : 'no'],
      ['Discoverable', fetchedChannel.isDiscoverable ? 'yes' : 'no'],
      ['Expires', fetchedChannel.expiresAt ?? 'never'],
      [
        'Failure threshold',
        fetchedChannel.failureThresholdPercent === null
          ? DEFAULT_POLICY_TEXT
          : `${fetchedChannel.failureThresholdPercent}%`,
      ],
      [
        'Failure min sample',
        String(fetchedChannel.failureMinSample ?? DEFAULT_POLICY_TEXT),
      ],
      ['Failure action', fetchedChannel.failureAction ?? DEFAULT_POLICY_TEXT],
      ['Active devices', String(fetchedChannel.activeDeviceCount)],
      ['Current devices', String(fetchedChannel.currentDeviceCount)],
      ['Embedded devices', String(fetchedChannel.embeddedDeviceCount)],
      ['Created', fetchedChannel.createdAt],
    ]);
  },
});
