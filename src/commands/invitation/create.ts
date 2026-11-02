import type { Invitation } from '@hotcodepush/node';
import { z } from 'zod';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import {
  confirmConsequence,
  promptSelect,
  promptText,
} from '../../utils/prompts.js';

const INVITATION_ROLES = [
  'admin',
  'billing',
  'member',
] as const satisfies Invitation['role'][];

export default defineCommand({
  description:
    'Invite an address to the organization with a role. The invitation mail is valid for two days.',
  examples: [
    'hotcodepush invitation create --email anna@example.com --role member',
    'hotcodepush invitation create --organization Acme --email anna@example.com --role admin --yes --json',
  ],
  options: defineCommandOptions({
    email: z.string().optional().describe('The address to invite.'),
    role: z
      .enum(INVITATION_ROLES)
      .optional()
      .describe('The role the invitee gets: admin, billing or member.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const email =
      options.email ??
      (await promptText(options, {
        flag: '--email',
        message: 'Which address do you invite?',
      }));
    const role =
      options.role ??
      (await promptSelect(options, {
        choices: INVITATION_ROLES.map(role => ({ label: role, value: role })),
        flag: '--role',
        message: 'Which role does the invitee get?',
      }));
    const fetchedOrganization = await hotCodePush.organizations.get({
      organizationId,
    });
    const isConfirmed = await confirmConsequence(
      `invites ${email} to organization ${fetchedOrganization.name} with role ${role}`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const createdInvitation =
      await hotCodePush.organizations.invitations.create({
        email,
        organizationId,
        role,
      });
    if (options.json) {
      printJson(createdInvitation);
      return;
    }
    printCreatedInvitation(createdInvitation, {
      organizationName: fetchedOrganization.name,
    });
  },
});

function printCreatedInvitation(
  invitation: Invitation,
  { organizationName }: { organizationName: string },
): void {
  printResult({
    rows: [
      ['ID', invitation.id],
      ['Organization', organizationName],
      ['Role', invitation.role],
    ],
    sentence: `Invited ${invitation.email}.`,
  });
}
