import {
  fetchMember,
  memberOptionShape,
  resolveMemberEmail,
} from '../../resources/members.js';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
  description:
    'Remove a member from the organization, or yourself to leave it. The Owner leaves only after transferring the ownership.',
  examples: [
    'hotcodepush member delete --member bob@example.com',
    'hotcodepush member delete --member 5e8a2c71-0b4d-4f39-9a6e-3c1d7b2f8e40 --yes --json',
  ],
  options: defineCommandOptions(memberOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const fetchedMember = await fetchMember(hotCodePush, {
      options,
      organizationId,
    });
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
      printJson({ id: fetchedMember.id, name: email });
    } else {
      printResult({
        rows: [['ID', fetchedMember.id]],
        sentence: `Removed member ${email}.`,
      });
    }
  },
});
