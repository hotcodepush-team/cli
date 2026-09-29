import { defineCommand } from 'zodline';
import type { AuthClient } from '../utils/auth-client.js';
import {
  createApiAuthClient,
  fetchSession,
  resolveResponseData,
} from '../utils/auth-client.js';
import { NotLoggedInError } from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { readToken } from '../utils/token-store.js';

interface Organization {
  id: string;
  name: string;
  role: string;
}

export default defineCommand({
  action: async options => {
    const token = readToken();
    if (token === undefined) {
      throw new NotLoggedInError();
    }
    const authClient = createApiAuthClient(token);
    const { user } = await fetchSession(authClient);
    const organizations = await fetchOrganizations(authClient);
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

/**
 * The organization plugin lists the organizations without the caller's role, so each role is one more request.
 */
async function fetchOrganizations(
  authClient: AuthClient,
): Promise<Organization[]> {
  const organizations = resolveResponseData(
    await authClient.organization.list(),
  );
  return Promise.all(
    organizations.map(async ({ id, name }) => {
      const { role } = resolveResponseData(
        await authClient.organization.getActiveMemberRole({
          query: { organizationId: id },
        }),
      );
      return { id, name, role };
    }),
  );
}
