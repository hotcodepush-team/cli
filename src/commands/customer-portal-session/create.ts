import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';

export default defineCommand({
  description:
    "Create a session of the customer portal for an organization's invoices and payment method, and print its URL to open.",
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
      return;
    }
    printResult({
      rows: [['URL', createdSession.url]],
      sentence:
        'Created a customer portal session. Open it for the invoices and the payment method.',
    });
  },
});
