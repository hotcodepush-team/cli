import type { Billing, Organization } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { promptText } from './prompts.js';

const CENTS_PER_DOLLAR = 100;

/** The devices a Free organization counts each month. */
const FREE_MONTHLY_ACTIVE_DEVICE_COUNT_LIMIT = 1_000;

/** A dollar of the cap buys 1,000 monthly active devices, so a cent buys ten. */
const MONTHLY_ACTIVE_DEVICES_PER_CENT = 10;

/** Polar's states of a subscription that stopped paying, whose cap buys no device. */
const UNPAID_SUBSCRIPTION_STATUSES: readonly string[] = ['canceled', 'unpaid'];

// whole dollars, as the cap is chosen; the API checks the range
const spendingCapSchema = z.coerce.number().int();

/**
 * The flag `billing update` and `checkout create` take, in whole dollars where the API counts cents.
 */
export const spendingCapShape = {
  spendingCap: spendingCapSchema
    .optional()
    .describe(
      'The most the organization pays a month, in whole dollars from 5 to 10000.',
    ),
};

/**
 * The cap asked for when the flag is missing and someone can answer, checked as the flag would be.
 */
export async function promptSpendingCap(
  options: InteractivityOptions,
): Promise<number> {
  const answer = await promptText(
    '--spending-cap',
    'What should the organization pay at most a month, in whole dollars?',
    options,
  );
  return z
    .object({ spendingCap: spendingCapSchema })
    .parse({ spendingCap: answer }).spendingCap;
}

/**
 * Whole dollars in the cents the API counts.
 */
export function resolveCents(dollars: number): number {
  return dollars * CENTS_PER_DOLLAR;
}

/**
 * Cents as the dollars a person chose, `$1,000`.
 */
export function resolveDollarText(cents: number): string {
  return `$${(cents / CENTS_PER_DOLLAR).toLocaleString('en-US')}`;
}

/**
 * The most devices the organization's month counts, the API's rule: Free's 1,000, the Enterprise deal's limit or none,
 * no device for a subscription that stopped paying, otherwise 1,000 a dollar of the spending cap.
 */
export function resolveMonthlyActiveDeviceCountLimit(
  organization: Organization,
): number | null {
  if (organization.plan === 'enterprise') {
    return organization.enterpriseMonthlyActiveDeviceCountLimit;
  }
  if (organization.plan === 'free') {
    return FREE_MONTHLY_ACTIVE_DEVICE_COUNT_LIMIT;
  }
  if (
    organization.subscriptionStatus !== null &&
    UNPAID_SUBSCRIPTION_STATUSES.includes(organization.subscriptionStatus)
  ) {
    return 0;
  }
  return organization.spendingCapCents * MONTHLY_ACTIVE_DEVICES_PER_CENT;
}

/**
 * What `billing get` and `billing update` print under `--json`: the billing read, the month's device ceiling the
 * organization derives, and the organization, whose row holds the plan, the cap and the subscription.
 */
export function buildBillingJson(
  billing: Billing,
  organization: Organization,
): object {
  return {
    ...billing,
    monthlyActiveDeviceCountLimit:
      resolveMonthlyActiveDeviceCountLimit(organization),
    organization,
  };
}
