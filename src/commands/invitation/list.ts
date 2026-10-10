import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List the organization's pending invitations, the ones a link can still accept, newest first.",
  examples: [
    'hotcodepush invitation list --organization Acme',
    'hotcodepush invitation list --limit 10 --offset 10 --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedInvitations = await hotCodePush.organizations.invitations.list({
      limit: options.limit,
      offset: options.offset,
      organizationId: await fetchOrganizationId(hotCodePush, options),
      status: 'pending',
    });
    const nextOffset = resolveNextOffset(listedInvitations.length, options);
    if (options.json) {
      printJson({ invitations: listedInvitations, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No pending invitations.',
      headers: ['ID', 'EMAIL', 'ROLE', 'EXPIRES', 'CREATED'],
      nextOffset,
      rows: listedInvitations.map(
        ({ createdAt, email, expiresAt, id, role }) => [
          id,
          email,
          role,
          resolveDate(expiresAt),
          resolveDate(createdAt),
        ],
      ),
    });
  },
});
