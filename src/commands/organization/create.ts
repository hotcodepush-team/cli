import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { promptText } from '../../utils/prompts.js';

export default defineCommand({
  description: 'Create an organization with you as its Owner.',
  examples: [
    'hotcodepush organization create --name Acme',
    'hotcodepush organization create --name Acme --json',
  ],
  options: defineCommandOptions({
    name: z.string().optional().describe("The organization's name."),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const name =
      options.name ??
      (await promptText('--name', 'What is the organization called?', options));
    const createdOrganization = await hotCodePush.organizations.create({
      name,
    });
    if (options.json) {
      printJson(createdOrganization);
    } else {
      console.log(
        `Created organization ${createdOrganization.name} (${createdOrganization.id}).`,
      );
    }
  },
});
