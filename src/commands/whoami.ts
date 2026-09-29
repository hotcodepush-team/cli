import type { HotCodePush } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../utils/api-client.js';
import { createApiAuthClient, fetchSession } from '../utils/auth-client.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { fetchOrganizations } from '../utils/resource-resolution.js';
import { readToken } from '../utils/token-store.js';

export interface User {
  email: string;
  id: string;
  name: string;
}

/**
 * The client once it carries `GET /v1/users/me`, the route an API token's user is read from.
 */
interface UsersResourceWithGet {
  get: (userId: 'me') => Promise<User>;
}

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const user = await fetchUser(hotCodePush);
    const organizations = (await fetchOrganizations(hotCodePush)).map(
      ({ id, name, role }) => ({ id, name, role }),
    );
    if (options.json) {
      printJson({ organizations, user });
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
 * The user behind the credential: from `GET /v1/users/me` once the client has it, until then from the session,
 * which an API token does not have — the gap hotcodepush-team/cli#10 tracks.
 */
export async function fetchUser(hotCodePush: HotCodePush): Promise<User> {
  const users: unknown = hotCodePush.users;
  if (hasUserGet(users)) {
    return users.get('me');
  }
  const { user } = await fetchSession(createApiAuthClient(readToken()));
  return { email: user.email, id: user.id, name: user.name };
}

function hasUserGet(users: unknown): users is UsersResourceWithGet {
  return (
    typeof users === 'object' &&
    users !== null &&
    typeof (users as Partial<UsersResourceWithGet>).get === 'function'
  );
}
