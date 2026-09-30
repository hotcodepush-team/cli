import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description: "List an app's channels, newest first.",
  examples: [
    'hotcodepush channel list',
    'hotcodepush channel list --app "My App" --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedChannels = await hotCodePush.apps.channels.list({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      limit: options.limit,
      offset: options.offset,
    });
    const nextOffset = resolveNextOffset(listedChannels.length, options);
    if (options.json) {
      printJson({ channels: listedChannels, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No channels.',
      headers: ['ID', 'NAME', 'STATE', 'CREATED'],
      nextOffset,
      rows: listedChannels.map(({ createdAt, id, name, pausedAt }) => [
        id,
        name,
        pausedAt === null ? 'running' : 'paused',
        resolveDate(createdAt),
      ]),
    });
  },
});
