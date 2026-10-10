import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "Create a session of Polar's customer portal for an organization's invoices and payment method, and print its URL to open.",
  examples: [
    'hotcodepush customer-portal-session create',
    'hotcodepush customer-portal-session create --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const createdSession =
      await hotCodePush.organizations.customerPortalSessions.create({
        organizationId: await fetchOrganizationId(hotCodePush, options),
      });
    if (options.json) {
      printJson(createdSession);
    } else {
      console.log(
        `Open the customer portal for the invoices and the payment method: ${createdSession.url}`,
      );
    }
  },
});
