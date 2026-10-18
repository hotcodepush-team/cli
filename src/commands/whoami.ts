import { defineCommand } from 'zodline';
import { DEFAULT_API_URL } from '../config/consts.js';
import { createApiClient } from '../utils/api-client.js';
import { resolveCredentialText } from '../utils/credential.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { resolveMemberRole } from '../utils/member-resolution.js';
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
    const hotCodePush = createApiClient();
    const { members = [], ...user } = await hotCodePush.users.get({
      relations: ['members'],
      userId: 'me',
    });
    const organizations = (await fetchOrganizations(hotCodePush)).map(
      ({ id, name }) => ({ id, name, role: resolveMemberRole(members, id) }),
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
      console.log(role === null ? `  ${name}` : `  ${name} (${role})`);
    }
  },
});
