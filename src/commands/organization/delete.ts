import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, resolveQuantityText } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchApps,
  fetchOrganizationId,
} from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const [fetchedOrganization, fetchedApps] = await Promise.all([
      hotCodePush.organizations.get({ organizationId }),
      fetchApps(hotCodePush, organizationId),
    ]);
    const isConfirmed = await confirmConsequence(
      resolveDeletionConsequence(fetchedOrganization.name, fetchedApps.length),
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.organizations.delete({ organizationId });
    if (options.json) {
      printJson({ id: organizationId, name: fetchedOrganization.name });
    } else {
      console.log(
        `Deleted organization ${fetchedOrganization.name} (${organizationId}).`,
      );
    }
  },
  description:
    'Delete an organization with everything in it; support can restore it for seven days.',
  examples: [
    'hotcodepush organization delete --organization Acme',
    'hotcodepush organization delete --organization Acme --yes --json',
  ],
  options: defineCommandOptions({}),
});

function resolveDeletionConsequence(
  organizationName: string,
  appCount: number,
): string {
  const deletion = `deletes organization ${organizationName}`;
  return appCount === 0
    ? deletion
    : `${deletion} and its ${resolveQuantityText(appCount, 'app')}`;
}
