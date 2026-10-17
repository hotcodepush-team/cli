import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import {
  buildBillingJson,
  resolveDollarText,
  resolveMonthlyActiveDeviceCountLimit,
} from '../../utils/spending-cap.js';

export default defineCommand({
  description:
    "Print an organization's billing this month: the plan, the spending cap and the MAU counted against the ceiling.",
  examples: [
    'hotcodepush billing get',
    'hotcodepush billing get --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const [fetchedBilling, fetchedOrganization] = await Promise.all([
      hotCodePush.organizations.billing.get({ organizationId }),
      hotCodePush.organizations.get({ organizationId }),
    ]);
    if (options.json) {
      printJson(buildBillingJson(fetchedBilling, fetchedOrganization));
      return;
    }
    const cappedAt = resolveCappedAtOfMonth(
      fetchedOrganization.cappedAt,
      new Date(),
    );
    printDetails([
      ['Plan', fetchedOrganization.plan],
      [
        'Spending cap',
        `${resolveDollarText(fetchedOrganization.spendingCapCents)} a month`,
      ],
      [
        'MAU',
        resolveMonthlyActiveDeviceText(
          fetchedBilling.monthlyActiveDeviceCount,
          resolveMonthlyActiveDeviceCountLimit(fetchedOrganization),
        ),
      ],
      ['Capped', cappedAt === null ? 'no' : `since ${cappedAt}`],
    ]);
  },
});

/**
 * `cappedAt` when it falls in the current UTC month; an earlier month's stamp stays on the organization until the
 * month's first report clears it and no longer applies.
 */
function resolveCappedAtOfMonth(
  cappedAt: string | null,
  now: Date,
): string | null {
  if (cappedAt === null) {
    return null;
  }
  const cappedDate = new Date(cappedAt);
  return cappedDate.getUTCFullYear() === now.getUTCFullYear() &&
    cappedDate.getUTCMonth() === now.getUTCMonth()
    ? cappedAt
    : null;
}

/**
 * The devices counted this month against what the month counts at most; an Enterprise deal may set no ceiling.
 */
function resolveMonthlyActiveDeviceText(
  monthlyActiveDeviceCount: number,
  monthlyActiveDeviceCountLimit: number | null,
): string {
  const countText = monthlyActiveDeviceCount.toLocaleString('en-US');
  return monthlyActiveDeviceCountLimit === null
    ? `${countText}, no ceiling`
    : `${countText} of ${monthlyActiveDeviceCountLimit.toLocaleString('en-US')}`;
}
