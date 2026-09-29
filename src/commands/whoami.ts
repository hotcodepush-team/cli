import { defineCommand } from 'zodline';
import { createApiClient } from '../utils/api-client.js';
import { createApiAuthClient, fetchSession } from '../utils/auth-client.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { fetchOrganizations } from '../utils/resource-resolution.js';
import { readToken } from '../utils/token-store.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const { user } = await fetchSession(createApiAuthClient(readToken()));
    const organizations = (await fetchOrganizations(hotCodePush)).map(
      ({ id, name, role }) => ({ id, name, role }),
    );
    if (options.json) {
      printJson({
        organizations,
        user: { email: user.email, id: user.id, name: user.name },
      });
      return;
    }
    console.log(`Logged in as ${user.name} (${user.email}).`);
    console.log(
      organizations.length === 0
        ? 'Organizations: none yet.'
        : 'Organizations:',
    );
    for (const { name, role } of organizations) {
      console.log(`  ${name} (${role})`);
    }
  },
  description: 'Print the user you are logged in as and their organizations.',
  examples: ['hotcodepush whoami', 'hotcodepush whoami --json'],
  options: defineCommandOptions({}),
});
