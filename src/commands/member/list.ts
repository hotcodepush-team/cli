import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveMemberEmail } from '../../utils/member-resolution.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List the organization's members with their roles, newest first.",
  examples: [
    'hotcodepush member list --organization Acme',
    'hotcodepush member list --limit 10 --offset 10 --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedMembers = await hotCodePush.organizations.members.list({
      limit: options.limit,
      offset: options.offset,
      organizationId: await fetchOrganizationId(hotCodePush, options),
      relations: ['user'],
    });
    const nextOffset = resolveNextOffset(listedMembers.length, options);
    if (options.json) {
      printJson({ members: listedMembers, nextOffset });
      return;
    }
    printTable({
      emptyText: 'No members.',
      headers: ['ID', 'NAME', 'EMAIL', 'ROLE', 'JOINED'],
      nextOffset,
      rows: listedMembers.map(member => [
        member.id,
        member.user?.name ?? '',
        resolveMemberEmail(member),
        member.role,
        resolveDate(member.createdAt),
      ]),
    });
  },
});
