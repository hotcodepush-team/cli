import type { Billing } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import {
  promptSpendingCap,
  resolveCents,
  resolveDollarText,
  spendingCapShape,
} from '../../utils/spending-cap.js';

export default defineCommand({
  description: "Set an organization's spending cap; the change applies now.",
  examples: [
    'hotcodepush billing update --spending-cap 100',
    'hotcodepush billing update --organization Acme --spending-cap 50 --yes --json',
  ],
  options: defineCommandOptions(spendingCapShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const spendingCapCents = resolveCents(
      options.spendingCap ?? (await promptSpendingCap(options)),
    );
    const [fetchedOrganization, fetchedBilling] = await Promise.all([
      hotCodePush.organizations.get({ organizationId }),
      hotCodePush.organizations.billing.get({ organizationId }),
    ]);
    const isConfirmed =
      spendingCapCents === fetchedBilling.spendingCapCents ||
      (await confirmConsequence(
        resolveSpendingCapConsequence(
          fetchedOrganization.name,
          fetchedBilling.spendingCapCents,
          spendingCapCents,
        ),
        options,
      ));
    if (!isConfirmed) {
      return;
    }
    const updatedBilling = await hotCodePush.organizations.billing.update({
      organizationId,
      spendingCapCents,
    });
    if (options.json) {
      printJson(updatedBilling);
    } else {
      console.log(
        resolveUpdatedLine(
          fetchedOrganization.name,
          fetchedBilling.spendingCapCents,
          updatedBilling,
        ),
      );
    }
  },
});

/**
 * What a changed cap does against the one in force; either applies now, and a lower one keeps the devices this month counted.
 */
function resolveSpendingCapConsequence(
  organizationName: string,
  previousSpendingCapCents: number,
  newSpendingCapCents: number,
): string {
  const capText = `the spending cap of ${organizationName}`;
  const previousText = resolveDollarText(previousSpendingCapCents);
  const newText = resolveDollarText(newSpendingCapCents);
  return newSpendingCapCents > previousSpendingCapCents
    ? `raises ${capText} from ${previousText} to ${newText} a month, applying now`
    : `lowers ${capText} from ${previousText} to ${newText} a month and applies now. Devices counted this month stay counted, and if they already exceed the new cap, no further device is counted until the cap is raised or the month turns`;
}

/**
 * The line the update ends on, from the cap the API answered against the one in force before.
 */
function resolveUpdatedLine(
  organizationName: string,
  previousSpendingCapCents: number,
  { spendingCapCents }: Billing,
): string {
  const capText = `the spending cap of ${organizationName}`;
  const capDollarText = resolveDollarText(spendingCapCents);
  if (spendingCapCents === previousSpendingCapCents) {
    return `The spending cap of ${organizationName} is already ${capDollarText} a month; nothing changes.`;
  }
  return spendingCapCents > previousSpendingCapCents
    ? `Set ${capText} to ${capDollarText} a month.`
    : `Lowered ${capText} to ${capDollarText} a month; it applies now.`;
}
