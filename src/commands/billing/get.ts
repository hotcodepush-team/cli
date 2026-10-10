import type { Billing } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import { resolveDollarText } from '../../utils/spending-cap.js';

export default defineCommand({
  description:
    "Print an organization's billing this month: the plan, the spending cap and a lower one waiting, and the MAU counted against the ceiling.",
  examples: [
    'hotcodepush billing get',
    'hotcodepush billing get --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedBilling = await hotCodePush.organizations.billing.get({
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    if (options.json) {
      printJson(fetchedBilling);
      return;
    }
    printDetails([
      ['Plan', fetchedBilling.plan],
      [
        'Spending cap',
        `${resolveDollarText(fetchedBilling.spendingCapCents)} a month`,
      ],
      ...resolveNextSpendingCapDetails(fetchedBilling),
      ['MAU', resolveMauText(fetchedBilling)],
      [
        'Capped',
        fetchedBilling.cappedAt === null
          ? 'no'
          : `since ${fetchedBilling.cappedAt}`,
      ],
    ]);
  },
});

/**
 * The devices counted this month against what the month counts at most; an Enterprise deal may set no ceiling.
 */
function resolveMauText({ countedMau, mauCap }: Billing): string {
  const countedText = countedMau.toLocaleString('en-US');
  return mauCap === null
    ? `${countedText}, no ceiling`
    : `${countedText} of ${mauCap.toLocaleString('en-US')}`;
}

/**
 * A lowered cap waiting for the month it applies from, when one waits.
 */
function resolveNextSpendingCapDetails({
  nextSpendingCapCents,
  nextSpendingCapStartsAt,
}: Billing): [label: string, value: string][] {
  return nextSpendingCapCents === null
    ? []
    : [
        [
          'Next spending cap',
          `${resolveDollarText(nextSpendingCapCents)} a month from ${nextSpendingCapStartsAt ?? 'the next billing month'}`,
        ],
      ];
}
