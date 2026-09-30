import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';

export default defineCommand({
  description: 'List your organizations with your role in each, newest first.',
  examples: [
    'hotcodepush organization list',
    'hotcodepush organization list --limit 10 --offset 10 --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedOrganizations = await hotCodePush.organizations.list({
      limit: options.limit,
      offset: options.offset,
    });
    const nextOffset = resolveNextOffset(listedOrganizations.length, options);
    if (options.json) {
      printJson({ nextOffset, organizations: listedOrganizations });
      return;
    }
    printTable({
      emptyText: 'No organizations.',
      headers: ['ID', 'NAME', 'ROLE', 'CREATED'],
      nextOffset,
      rows: listedOrganizations.map(({ createdAt, id, name, role }) => [
        id,
        name,
        role ?? '',
        resolveDate(createdAt),
      ]),
    });
  },
});
