import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

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
      (await promptText('--name', 'What is the app called now?', options));
    const updatedApp = await hotCodePush.apps.update({ appId, name });
    if (options.json) {
      printJson(updatedApp);
    } else {
      console.log(`Updated app ${updatedApp.name} (${updatedApp.id}).`);
    }
  },
  description: "Rename an app, hotcodepush.json's by default.",
  examples: [
    'hotcodepush app update --name "My New App"',
    'hotcodepush app update --app "My App" --name "My New App" --json',
  ],
  options: defineCommandOptions({
    name: z
      .string()
      .optional()
      .describe("The app's new name, unique in the organization."),
  }),
});
