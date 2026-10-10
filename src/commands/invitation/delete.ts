import type { Invitation } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { fetchAllPages } from '../../utils/pagination.js';
import { confirmConsequence, promptSelect } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Withdraw a pending invitation; the link in its mail stops working at once.',
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
    // the organization's invitations have no read by id, and only a pending one is unique by its email
    const pendingInvitations = await fetchAllPages(page =>
      hotCodePush.organizations.invitations.list({
        organizationId,
        status: 'pending',
        ...page,
      }),
    );
    const invitation = resolveInvitation(
      pendingInvitations,
      options.invitation ??
        (await promptSelect(
          '--invitation',
          'Which invitation?',
          pendingInvitations.map(({ email, id }) => ({
            label: email,
            value: id,
          })),
          options,
        )),
    );
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
      // every delete prints { id, name }, and an invitation's name is its email, as the flag takes it
      printJson({ id: invitation.id, name: invitation.email });
    } else {
      console.log(
        `Withdrew the invitation to ${invitation.email} (${invitation.id}).`,
      );
    }
  },
});

/**
 * The pending invitation of the id or the email given, the email compared case-insensitively as the API stores it lowercased.
 */
function resolveInvitation(
  invitations: Invitation[],
  reference: string,
): Invitation {
  const lowercasedReference = reference.toLowerCase();
  const invitation = invitations.find(
    ({ email, id }) =>
      id === reference || email.toLowerCase() === lowercasedReference,
  );
  if (invitation === undefined) {
    throw new InvalidParameterError(
      `--invitation: the organization has no pending invitation ${reference}`,
      undefined,
      'run "hotcodepush invitation list" for the ids and emails.',
    );
  }
  return invitation;
}
