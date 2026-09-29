import type { App } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { promptSelect, promptText } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

const FRAMEWORKS = [
  'capacitor',
  'cordova',
  'expo',
  'react-native',
] as const satisfies App['framework'][];

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const name =
      options.name ??
      (await promptText('--name', 'What is the app called?', options));
    const framework =
      options.framework ??
      (await promptSelect(
        '--framework',
        'Which framework does the app use?',
        FRAMEWORKS.map(framework => ({ label: framework, value: framework })),
        options,
      ));
    const createdApp = await hotCodePush.organizations.apps.create({
      framework,
      name,
      organizationId,
    });
    if (options.json) {
      printJson(createdApp);
    } else {
      console.log(`Created app ${createdApp.name} (${createdApp.id}).`);
    }
  },
  description: 'Create an app with its default channel, production.',
  examples: [
    'hotcodepush app create --name "My App" --framework capacitor',
    'hotcodepush app create --organization Acme --name "My App" --framework expo --json',
  ],
  options: defineCommandOptions({
    framework: z
      .enum(FRAMEWORKS)
      .optional()
      .describe('The framework: capacitor, cordova, expo or react-native.'),
    name: z
      .string()
      .optional()
      .describe("The app's name, unique in the organization."),
  }),
});
