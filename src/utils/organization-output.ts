import type { Organization } from '@hotcodepush/node';
import { printDetails } from './output.js';
import { resolveDollarText } from './spending-cap.js';

export function printOrganizationDetails(organization: Organization): void {
  printDetails([
    ['ID', organization.id],
    ['Name', organization.name],
    ['Plan', organization.plan],
    [
      'Spending cap',
      `${resolveDollarText(organization.spendingCapCents)} a month`,
    ],
    ['Region', organization.region],
    ['Created', organization.createdAt],
  ]);
}
