import { defineCommand } from 'zodline';
import { createApiAuthClient } from '../utils/auth-client.js';
import { resolveApiError } from '../utils/error-mapping.js';
import { NotLoggedInError } from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { deleteToken, readToken } from '../utils/token-store.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';

const UNAUTHORIZED_STATUS = 401;

export default defineCommand({
  action: async options => {
    const token = readToken();
    if (token === undefined) {
      throw new NotLoggedInError();
    }
    const { error } = await createApiAuthClient(token).revokeSession({
      token: resolveUnsignedToken(token),
    });
    // A 401 means the session already ended, so only the stored copies are left to clear
    if (error !== null && error.status !== UNAUTHORIZED_STATUS) {
      throw resolveApiError(error);
    }
    deleteToken();
    deleteSessionId();
    if (options.json) {
      printJson({});
    } else {
      console.log('Logged out.');
    }
  },
  description: 'End the session and remove the stored token.',
  examples: ['hotcodepush logout', 'hotcodepush logout --json'],
  options: defineCommandOptions({}),
});

function deleteSessionId(): void {
  const userConfig = readUserConfig();
  if (userConfig.sessionId === undefined) {
    return;
  }
  delete userConfig.sessionId;
  writeUserConfig(userConfig);
}

/**
 * A bearer can be the signed form, `<token>.<signature>`, while revoke-session looks the session up by the token alone.
 */
function resolveUnsignedToken(token: string): string {
  const [unsignedToken = token] = token.split('.');
  return unsignedToken;
}
