import { fetchAppId } from '../../resources/apps.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';

export default defineCommand({
  description: "Print an app, hotcodepush.json's by default.",
  examples: [
    'hotcodepush app get',
    'hotcodepush app get --app "My App" --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedApp = await hotCodePush.apps.get({
      appId: await fetchAppId(hotCodePush, {
        options,
        projectConfig: readProjectConfig(options.config),
      }),
    });
    if (options.json) {
      printJson(fetchedApp);
      return;
    }
    printDetails([
      ['ID', fetchedApp.id],
      ['Name', fetchedApp.name],
      ['Framework', fetchedApp.framework],
      ['Organization', fetchedApp.organizationId],
      ['Default channel', fetchedApp.defaultChannelId ?? 'none'],
      ['Channel link template', fetchedApp.channelLinkTemplate ?? 'none'],
      ['Created', fetchedApp.createdAt],
    ]);
  },
});
