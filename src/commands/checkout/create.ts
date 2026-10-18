import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Enable billing on a free organization: create the Polar checkout for pay-as-you-go and print its URL to open.',
  examples: [
    'hotcodepush checkout create',
    'hotcodepush checkout create --organization Acme --billing-email billing@example.com --json',
  ],
  options: defineCommandOptions({
    billingEmail: z
      .string()
      .optional()
      .describe(
        'The email the organization is billed under, yours by default.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const createdCheckout = await hotCodePush.organizations.checkouts.create({
      billingEmail: options.billingEmail,
      organizationId,
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
