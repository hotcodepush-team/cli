import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { isInteractive } from '../../utils/environment.js';
import { MissingParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { promptSelect, promptText } from '../../utils/prompts.js';

export default defineCommand({
  description:
    'Accept an invitation to an organization with the token from its mail.',
  examples: [
    'hotcodepush invitation accept',
    'hotcodepush invitation accept --invitation 4c8e2a6f-1d3b-4e97-a5c0-8f2d6b4a1e93 --token p8Xc2LmQ4rTzN7vB --json',
  ],
  options: defineCommandOptions({
    invitation: z
      .string()
      .optional()
      .describe('The invitation, by the id its mail carries.'),
    token: z
      .string()
      .optional()
      .describe('The token the invitation mail carries.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const invitationId =
      options.invitation ?? (await promptInvitationId(hotCodePush, options));
    const token =
      options.token ??
      (await promptText(
        '--token',
        'What is the token from the invitation mail?',
        options,
      ));
    const acceptedMember = await hotCodePush.invitations.accept({
      invitationId,
      token,
    });
    if (options.json) {
      printJson(acceptedMember);
    } else {
      console.log(
        `Joined organization ${acceptedMember.organizationId} with role ${acceptedMember.role}.`,
      );
    }
  },
});

/**
 * One of the caller's pending invitations picked when interactive; otherwise the flag is missing.
 */
async function promptInvitationId(
  hotCodePush: HotCodePush,
  options: InteractivityOptions,
): Promise<string> {
  if (!isInteractive(options)) {
    throw new MissingParameterError('--invitation');
  }
  const fetchedInvitations = await hotCodePush.invitations.list();
  return promptSelect(
    '--invitation',
    'Which invitation?',
    fetchedInvitations.map(
      ({ id, organizationId, organizationName, role }) => ({
        label: `${organizationName ?? organizationId} with role ${role}`,
        value: id,
      }),
    ),
    options,
  );
}
