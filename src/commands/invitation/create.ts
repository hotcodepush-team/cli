import type { Invitation } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import {
  confirmConsequence,
  promptSelect,
  promptText,
} from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

const INVITATION_ROLES = [
  'admin',
  'billing',
  'member',
] as const satisfies Invitation['role'][];

export default defineCommand({
  description:
    'Invite an address to the organization with a role; the invitation mail is valid for two days.',
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
      (await promptText('--email', 'Which address do you invite?', options));
    const role =
      options.role ??
      (await promptSelect(
        '--role',
        'Which role does the invitee get?',
        INVITATION_ROLES.map(role => ({ label: role, value: role })),
        options,
      ));
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
    } else {
      console.log(
        `Invited ${createdInvitation.email} (${createdInvitation.id}) to organization ${fetchedOrganization.name} with role ${createdInvitation.role}.`,
      );
    }
  },
});
