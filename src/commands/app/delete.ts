import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, resolveQuantityText } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { fetchAppId, fetchChannels } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Delete an app with its channels, bundles and releases; support can restore it for seven days.',
  examples: [
    'hotcodepush app delete --app "My App"',
    'hotcodepush app delete --app 7c9e6679-7425-40de-944b-e07fc1f90ae7 --yes --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const [fetchedApp, fetchedChannels] = await Promise.all([
      hotCodePush.apps.get({ appId }),
      fetchChannels(hotCodePush, appId),
    ]);
    const isConfirmed = await confirmConsequence(
      `deletes app ${fetchedApp.name} and its ${resolveQuantityText(fetchedChannels.length, 'channel')}`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.apps.delete({ appId });
    if (options.json) {
      printJson({ id: appId, name: fetchedApp.name });
    } else {
      console.log(`Deleted app ${fetchedApp.name} (${appId}).`);
    }
  },
});
