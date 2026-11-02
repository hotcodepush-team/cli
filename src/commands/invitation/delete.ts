import { z } from 'zod';
import { fetchPendingInvitation } from '../../resources/invitations.js';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
  description:
    'Withdraw a pending invitation. The link in its mail stops working at once.',
  examples: [
    'hotcodepush invitation delete --invitation anna@example.com',
    'hotcodepush invitation delete --invitation 4c8e2a6f-1d3b-4e97-a5c0-8f2d6b4a1e93 --yes --json',
  ],
  options: defineCommandOptions({
    invitation: z
      .string()
      .optional()
      .describe('The pending invitation, by id or email.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const invitation = await fetchPendingInvitation(hotCodePush, {
      options,
      organizationId,
    });
    const isConfirmed = await confirmConsequence(
      `withdraws the invitation to ${invitation.email}: the link in its mail stops working`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.organizations.invitations.delete({
      invitationId: invitation.id,
      organizationId,
    });
    if (options.json) {
      printJson({ id: invitation.id, name: invitation.email });
    } else {
      printResult({
        rows: [['ID', invitation.id]],
        sentence: `Withdrew the invitation to ${invitation.email}.`,
      });
    }
  },
});
