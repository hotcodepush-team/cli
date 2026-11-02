import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptText } from '../../utils/prompts.js';

export default defineCommand({
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
        message: 'What is the app called now?',
      }));
    const updatedApp = await hotCodePush.apps.update({ appId, name });
    if (options.json) {
      printJson(updatedApp);
    } else {
      printResult({
        rows: [['ID', updatedApp.id]],
        sentence: `Updated app ${updatedApp.name}.`,
      });
    }
  },
});
