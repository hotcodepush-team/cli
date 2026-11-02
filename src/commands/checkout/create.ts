import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';

export default defineCommand({
  description:
    'Enable billing on a free organization: create the checkout for pay-as-you-go and print its URL to open.',
  examples: [
    'hotcodepush checkout create',
    'hotcodepush checkout create --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const createdCheckout = await hotCodePush.organizations.checkouts.create({
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    if (options.json) {
      printJson(createdCheckout);
      return;
    }
    printResult({
      rows: [['URL', createdCheckout.url]],
      sentence: 'Created the checkout. Open it to enable billing.',
    });
  },
});
