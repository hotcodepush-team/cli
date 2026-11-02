import type { HotCodePush, Organization } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from '../utils/environment.js';
import type { Detail } from '../utils/output.js';
import { fetchAllPages } from '../utils/pagination.js';
import { fetchResourceId, promptResourceId } from '../utils/resources.js';

export interface OrganizationOptions extends InteractivityOptions {
  organization?: string;
}

const CENTS_PER_DOLLAR = 100;

// The flag takes whole dollars, while the API counts cents and checks the range.
export const spendingCapShape = {
  spendingCap: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The most the organization pays a month, in whole dollars from $5 to $10,000.',
    ),
};

export async function fetchOrganizationId(
  hotCodePush: HotCodePush,
  options: OrganizationOptions,
): Promise<string> {
  if (options.organization !== undefined) {
    return fetchResourceId({
      fetchResources: () => fetchOrganizations(hotCodePush),
      noun: 'organization',
      reference: options.organization,
    });
  }
  const fetchedOrganizations = await fetchOrganizations(hotCodePush);
  const [onlyOrganization] = fetchedOrganizations;
  if (onlyOrganization !== undefined && fetchedOrganizations.length === 1) {
    return onlyOrganization.id;
  }
  return promptResourceId(options, {
    noun: 'organization',
    resources: fetchedOrganizations,
  });
}

export function fetchOrganizations(
  hotCodePush: HotCodePush,
): Promise<Organization[]> {
  return fetchAllPages(page => hotCodePush.organizations.list(page));
}

export function resolveOrganizationDetails(
  organization: Organization,
): Detail[] {
  return [
    ['ID', organization.id],
    ['Name', organization.name],
    ['Plan', organization.plan],
    [
      'Spending cap',
      `${resolveDollarText(organization.spendingCapCents)} a month`,
    ],
    ['Region', organization.region],
    ['Created', organization.createdAt],
  ];
}

export function resolveCents(dollars: number): number {
  return dollars * CENTS_PER_DOLLAR;
}

export function resolveDollarText(cents: number): string {
  return `$${(cents / CENTS_PER_DOLLAR).toLocaleString('en-US')}`;
}
