import { defineCommand } from 'zodline';
import { createApiClient } from '../utils/api-client.js';
import {
  fetchCurrentUser,
  resolveCredentialText,
} from '../utils/credential.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { fetchOrganizations } from '../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const user = await fetchCurrentUser();
    const organizations = (await fetchOrganizations(createApiClient())).map(
      ({ id, name, role }) => ({ id, name, role }),
    );
    if (options.json) {
      printJson({ organizations, user });
      return;
    }
    const credentialText = resolveCredentialText(user);
    console.log(
      `${credentialText.charAt(0).toUpperCase()}${credentialText.slice(1)}.`,
    );
    console.log(
      organizations.length === 0
        ? 'Organizations: none yet.'
        : 'Organizations:',
    );
    for (const { name, role } of organizations) {
      console.log(`  ${name} (${role})`);
    }
  },
  description:
    'Print the user you are logged in as, or the one HOTCODEPUSH_TOKEN stands for, and their organizations.',
  examples: ['hotcodepush whoami', 'hotcodepush whoami --json'],
  options: defineCommandOptions({}),
});
