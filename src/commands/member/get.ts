import type { Member } from '@hotcodepush/node';
import {
  fetchMember,
  memberOptionShape,
  resolveMemberEmail,
} from '../../resources/members.js';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printDetails,
  printJson,
  resolveYesNoText,
} from '../../utils/output.js';

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
      ['Password', resolveYesNoText(hasPasswordAccount(fetchedMember))],
      ['Two-factor', resolveYesNoText(fetchedMember.user?.twoFactorEnabled)],
      ['Last seen', fetchedMember.lastSeenAt ?? 'never'],
      ['Joined', fetchedMember.createdAt],
    ]);
  },
});

// Better Auth stores a password as an account of the provider `credential`.
function hasPasswordAccount({ user }: Member): boolean {
  return (
    user?.accounts?.some(({ providerId }) => providerId === 'credential') ??
    false
  );
}
