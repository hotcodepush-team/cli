import { defineCommand } from 'zodline';
import { DEFAULT_API_URL } from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import {
  fetchCurrentUser,
  resolveCredentialText,
} from '../utils/credential.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { fetchOrganizations } from '../utils/resource-resolution.js';
import { isEnvironmentToken } from '../utils/token-store.js';
import { readApiUrl } from '../utils/user-config.js';

export default defineCommand({
  description:
    'Print the user you are logged in as, or the one HOTCODEPUSH_TOKEN stands for, and their organizations.',
  examples: ['hotcodepush whoami', 'hotcodepush whoami --json'],
  options: defineCommandOptions({}),
  action: async options => {
    const user = await fetchCurrentUser();
    const organizations = (await fetchOrganizations(createApiClient())).map(
      ({ id, name, role }) => ({ id, name, role }),
    );
    const apiUrl = readApiUrl();
    if (options.json) {
      printJson({ apiUrl, organizations, user });
      return;
    }
    console.log(resolveCredentialText(user, isEnvironmentToken()));
    if (apiUrl !== DEFAULT_API_URL) {
      console.log(`API: ${apiUrl}`);
    }
    console.log(
      organizations.length === 0
        ? 'Organizations: none yet.'
        : 'Organizations:',
    );
    for (const { name, role } of organizations) {
      console.log(`  ${name} (${role})`);
    }
  },
});
