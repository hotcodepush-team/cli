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
  description:
    "Set an organization's spending cap: a raise applies now, a lower cap from the next billing month.",
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
    const isConfirmed = await confirmConsequence(
      resolveSpendingCapConsequence(
        fetchedOrganization.name,
        fetchedBilling,
        spendingCapCents,
      ),
      options,
    );
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
          updatedBilling,
          spendingCapCents,
        ),
      );
    }
  },
});

/**
 * What the new cap does against the one the month bills: a raise applies now, a lower cap waits for the next billing month,
 * and the same cap withdraws a lower one waiting.
 */
function resolveSpendingCapConsequence(
  organizationName: string,
  { nextSpendingCapCents, spendingCapCents }: Billing,
  newSpendingCapCents: number,
): string {
  const capText = `the spending cap of ${organizationName}`;
  const currentText = resolveDollarText(spendingCapCents);
  const newText = resolveDollarText(newSpendingCapCents);
  if (newSpendingCapCents < spendingCapCents) {
    return `lowers ${capText} from ${currentText} to ${newText} a month from the next billing month; this month keeps ${currentText}`;
  }
  if (newSpendingCapCents > spendingCapCents) {
    return `raises ${capText} from ${currentText} to ${newText} a month, applying now`;
  }
  const withdrawalText =
    nextSpendingCapCents === null
      ? ''
      : `, withdrawing the lower cap of ${resolveDollarText(nextSpendingCapCents)} waiting for the next billing month`;
  return `keeps ${capText} at ${currentText} a month${withdrawalText}`;
}

/**
 * The line the update ends on, from what the API answered: the cap in force now, or the lower one waiting with its month.
 */
function resolveUpdatedLine(
  organizationName: string,
  { nextSpendingCapStartsAt, spendingCapCents }: Billing,
  newSpendingCapCents: number,
): string {
  const capText = `the spending cap of ${organizationName}`;
  return newSpendingCapCents === spendingCapCents
    ? `Set ${capText} to ${resolveDollarText(spendingCapCents)} a month.`
    : `Lowered ${capText} to ${resolveDollarText(newSpendingCapCents)} a month from ${nextSpendingCapStartsAt ?? 'the next billing month'}; this month keeps ${resolveDollarText(spendingCapCents)}.`;
}
