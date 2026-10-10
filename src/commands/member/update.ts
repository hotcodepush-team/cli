import type { Member } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  fetchMember,
  memberOptionShape,
  resolveMemberEmail,
} from '../../utils/member-resolution.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence, promptSelect } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

const MEMBER_ROLES = [
  'admin',
  'billing',
  'member',
  'owner',
] as const satisfies Member['role'][];

export default defineCommand({
  description:
    "Change a member's role; owner transfers the ownership to them and makes you an admin.",
  examples: [
    'hotcodepush member update --member bob@example.com --role admin',
    'hotcodepush member update --member 5e8a2c71-0b4d-4f39-9a6e-3c1d7b2f8e40 --role billing --json',
  ],
  options: defineCommandOptions({
    ...memberOptionShape,
    role: z
      .enum(MEMBER_ROLES)
      .optional()
      .describe(
        "The member's new role: admin, billing, member, or owner to transfer the ownership.",
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const fetchedMember = await fetchMember(
      hotCodePush,
      organizationId,
      options,
    );
    const role =
      options.role ??
      (await promptSelect(
        '--role',
        'Which role does the member get?',
        MEMBER_ROLES.map(role => ({ label: role, value: role })),
        options,
      ));
    const email = resolveMemberEmail(fetchedMember);
    if (role === 'owner') {
      const isConfirmed = await confirmConsequence(
        `transfers the ownership of the organization to member ${email} and makes you an admin; only they can transfer it back`,
        options,
      );
      if (!isConfirmed) {
        return;
      }
    }
    const updatedMember = await hotCodePush.organizations.members.update({
      memberId: fetchedMember.id,
      organizationId,
      role,
    });
    if (options.json) {
      printJson(updatedMember);
    } else {
      console.log(
        `Updated member ${email} (${updatedMember.id}) to role ${updatedMember.role}.`,
      );
    }
  },
});
