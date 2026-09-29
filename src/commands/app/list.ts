import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const listedApps = await hotCodePush.organizations.apps.list({
      limit: options.limit,
      offset: options.offset,
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    const nextOffset = resolveNextOffset(listedApps.length, options);
    if (options.json) {
      printJson({ apps: listedApps, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No apps.',
      headers: ['ID', 'NAME', 'FRAMEWORK', 'CREATED'],
      nextOffset,
      rows: listedApps.map(({ createdAt, framework, id, name }) => [
        id,
        name,
        framework,
        resolveDate(createdAt),
      ]),
    });
  },
  description: "List an organization's apps, newest first.",
  examples: [
    'hotcodepush app list',
    'hotcodepush app list --organization Acme --json',
  ],
  options: defineCommandOptions(paginationShape),
});
