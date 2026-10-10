import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  fetchMember,
  memberOptionShape,
  resolveMemberEmail,
} from '../../utils/member-resolution.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Print a member of the organization with their role and how they sign in.',
  examples: [
    'hotcodepush member get --member anna@example.com',
    'hotcodepush member get --member 2a7d4e91-6c3b-4f58-8e0a-9b1c5d3f7e62 --json',
  ],
  options: defineCommandOptions(memberOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedMember = await fetchMember(
      hotCodePush,
      await fetchOrganizationId(hotCodePush, options),
      options,
    );
    if (options.json) {
      printJson(fetchedMember);
      return;
    }
    printDetails([
      ['ID', fetchedMember.id],
      ['Name', fetchedMember.user?.name ?? ''],
      ['Email', resolveMemberEmail(fetchedMember)],
      ['Role', fetchedMember.role],
      ['Password', fetchedMember.user?.hasPassword ? 'yes' : 'no'],
      ['Two-factor', fetchedMember.user?.isTwoFactorEnabled ? 'yes' : 'no'],
      ['Last seen', fetchedMember.lastSeenAt ?? 'never'],
      ['Joined', fetchedMember.createdAt],
    ]);
  },
});
