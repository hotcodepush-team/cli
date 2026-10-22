import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

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
    } else {
      console.log(
        `Open the checkout to enable billing: ${createdCheckout.url}`,
      );
    }
  },
});
