import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  fetchMember,
  memberOptionShape,
  resolveMemberEmail,
} from '../../utils/member-resolution.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Remove a member from the organization, or yourself to leave it; the Owner leaves only after transferring the ownership.',
  examples: [
    'hotcodepush member delete --member bob@example.com',
    'hotcodepush member delete --member 5e8a2c71-0b4d-4f39-9a6e-3c1d7b2f8e40 --yes --json',
  ],
  options: defineCommandOptions(memberOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const fetchedMember = await fetchMember(
      hotCodePush,
      organizationId,
      options,
    );
    const email = resolveMemberEmail(fetchedMember);
    const isConfirmed = await confirmConsequence(
      `removes member ${email} from the organization`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.organizations.members.delete({
      memberId: fetchedMember.id,
      organizationId,
    });
    if (options.json) {
      // every delete prints { id, name }, and a member's name is their email, as the flag takes it
      printJson({ id: fetchedMember.id, name: email });
    } else {
      console.log(`Removed member ${email} (${fetchedMember.id}).`);
    }
  },
});
