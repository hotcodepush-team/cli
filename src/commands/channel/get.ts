import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  resolveEffectiveFailurePolicy,
  resolveFailurePolicyDetails,
} from '../../utils/channel-fields.js';
import { resolveReleaseDeviceCount } from '../../utils/fleet.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import {
  channelOptionShape,
  fetchChannel,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "Print a channel with its device counts, hotcodepush.json's by default.",
  examples: [
    'hotcodepush channel get',
    'hotcodepush channel get --channel staging --json',
  ],
  options: defineCommandOptions(channelOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedChannel = await fetchChannel(hotCodePush, options);
    if (options.json) {
      printJson(fetchedChannel);
      return;
    }
    const fleet = await hotCodePush.apps.statistics.fleet.get({
      appId: fetchedChannel.appId,
      channelId: fetchedChannel.id,
    });
    printDetails([
      ['ID', fetchedChannel.id],
      ['Name', fetchedChannel.name],
      [
        'Status',
        fetchedChannel.pausedAt === null
          ? 'running'
          : `paused since ${fetchedChannel.pausedAt}`,
      ],
      ['Protected', fetchedChannel.isProtected ? 'yes' : 'no'],
      ['Discoverable', fetchedChannel.isDiscoverable ? 'yes' : 'no'],
      ['Expires', fetchedChannel.expiresAt ?? 'never'],
      ...resolveFailurePolicyDetails(
        resolveEffectiveFailurePolicy(fetchedChannel),
      ),
      ['Active devices', String(fleet.deviceCount)],
      ['Current devices', String(fleet.currentDeviceCount)],
      ['Embedded devices', String(resolveReleaseDeviceCount(fleet, null))],
      ['Created', fetchedChannel.createdAt],
    ]);
  },
});
