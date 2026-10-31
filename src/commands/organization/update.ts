import type { Organization } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence, promptText } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';
import {
  resolveCents,
  resolveDollarText,
  spendingCapShape,
} from '../../utils/spending-cap.js';
import { printOrganizationDetails } from './get.js';

export default defineCommand({
  description:
    'Rename an organization or set its spending cap, which applies now.',
  examples: [
    'hotcodepush organization update --organization Acme --name "Acme Inc"',
    'hotcodepush organization update --spending-cap 100 --yes --json',
  ],
  options: defineCommandOptions({
    name: z.string().optional().describe("The organization's new name."),
    ...spendingCapShape,
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const spendingCapCents =
      options.spendingCap === undefined
        ? undefined
        : resolveCents(options.spendingCap);
    const name =
      options.name ??
      (spendingCapCents === undefined
        ? await promptText(
            '--name',
            'What is the organization called now?',
            options,
          )
        : undefined);
    if (spendingCapCents !== undefined) {
      const fetchedOrganization = await hotCodePush.organizations.get({
        organizationId,
      });
      const isConfirmed = await confirmSpendingCapChange(
        fetchedOrganization,
        spendingCapCents,
        options,
      );
      if (!isConfirmed) {
        return;
      }
    }
    const updatedOrganization = await hotCodePush.organizations.update({
      name,
      organizationId,
      spendingCapCents,
    });
    if (options.json) {
      printJson(updatedOrganization);
    } else {
      printOrganizationDetails(updatedOrganization);
    }
  },
});

// An unchanged cap needs no confirmation, since the API answers it with `no_change`.
async function confirmSpendingCapChange(
  organization: Organization,
  spendingCapCents: number,
  options: InteractivityOptions,
): Promise<boolean> {
  return (
    spendingCapCents === organization.spendingCapCents ||
    confirmConsequence(
      resolveSpendingCapConsequence(organization, spendingCapCents),
      options,
    )
  );
}

function resolveSpendingCapConsequence(
  organization: Organization,
  spendingCapCents: number,
): string {
  const capText = `the spending cap of ${organization.name}`;
  const previousText = resolveDollarText(organization.spendingCapCents);
  const newText = resolveDollarText(spendingCapCents);
  return spendingCapCents > organization.spendingCapCents
    ? `raises ${capText} from ${previousText} to ${newText} a month and applies now`
    : `lowers ${capText} from ${previousText} to ${newText} a month and applies now. Devices counted this month stay counted, and if they already exceed the new cap, no further device is counted until the cap is raised or the month turns`;
}
