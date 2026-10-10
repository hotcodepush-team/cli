import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import {
  promptSpendingCap,
  resolveCents,
  spendingCapShape,
} from '../../utils/spending-cap.js';

export default defineCommand({
  description:
    'Enable billing on a free organization: create the Polar checkout for pay-as-you-go with the spending cap chosen and print its URL to open.',
  examples: [
    'hotcodepush checkout create --spending-cap 50',
    'hotcodepush checkout create --organization Acme --spending-cap 50 --json',
  ],
  options: defineCommandOptions(spendingCapShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const createdCheckout = await hotCodePush.organizations.checkouts.create({
      organizationId,
      spendingCapCents: resolveCents(
        options.spendingCap ?? (await promptSpendingCap(options)),
      ),
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
