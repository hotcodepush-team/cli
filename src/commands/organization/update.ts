import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { promptText } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description: 'Rename an organization.',
  examples: [
    'hotcodepush organization update --organization Acme --name "Acme Inc"',
    'hotcodepush organization update --name "Acme Inc" --json',
  ],
  options: defineCommandOptions({
    name: z.string().optional().describe("The organization's new name."),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const name =
      options.name ??
      (await promptText(
        '--name',
        'What is the organization called now?',
        options,
      ));
    const updatedOrganization = await hotCodePush.organizations.update({
      name,
      organizationId,
    });
    if (options.json) {
      printJson(updatedOrganization);
    } else {
      console.log(
        `Updated organization ${updatedOrganization.name} (${updatedOrganization.id}).`,
      );
    }
  },
});
