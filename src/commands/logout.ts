import { defineCommand } from 'zodline';
import type { AuthClient } from '../utils/auth-client.js';
import { createApiAuthClient } from '../utils/auth-client.js';
import { resolveApiError } from '../utils/error-mapping.js';
import { NotLoggedInError } from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson } from '../utils/output.js';
import { deleteToken, readStoredToken } from '../utils/token-store.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';

/**
 * What went: the session's id and its user's name, as far as the API still knew them.
 */
interface EndedSession {
  id: string | null;
  name: string | null;
}

const UNAUTHORIZED_STATUS = 401;

export default defineCommand({
  action: async options => {
    const storedToken = readStoredToken();
    if (storedToken === undefined) {
      if (!process.env.HOTCODEPUSH_TOKEN) {
        throw new NotLoggedInError();
      }
      printEnded({ id: null, name: null }, options.json);
      return;
    }
    const authClient = createApiAuthClient(storedToken);
    const knownSession = await fetchKnownSession(authClient);
    const { error } = await authClient.revokeSession({
      token: resolveUnsignedToken(storedToken),
    });
    // A 401 means the session already ended, so only the stored copies are left to clear
    if (error !== null && error.status !== UNAUTHORIZED_STATUS) {
      throw resolveApiError(error);
    }
    deleteToken();
    const storedSessionId = deleteSessionId();
    printEnded(
      {
        id: knownSession?.session.id ?? storedSessionId ?? null,
        name: knownSession?.user.name ?? null,
      },
      options.json,
    );
  },
  description:
    'End the stored session and remove its token; HOTCODEPUSH_TOKEN, when set, stays what it is.',
  examples: ['hotcodepush logout', 'hotcodepush logout --json'],
  options: defineCommandOptions({}),
});

function deleteSessionId(): string | undefined {
  const userConfig = readUserConfig();
  const { sessionId } = userConfig;
  if (sessionId === undefined) {
    return undefined;
  }
  delete userConfig.sessionId;
  writeUserConfig(userConfig);
  return sessionId;
}

/**
 * The session the stored token still stands for, null once the API no longer knows it.
 */
async function fetchKnownSession(authClient: AuthClient) {
  const { data, error } = await authClient.getSession();
  if (error !== null) {
    if (error.status === UNAUTHORIZED_STATUS) {
      return null;
    }
    throw resolveApiError(error);
  }
  return data;
}

/**
 * The line and the document say the same: who was logged out, and that the variable, when set, still authenticates.
 */
function printEnded(
  endedSession: EndedSession,
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson(endedSession);
    return;
  }
  const variableText = process.env.HOTCODEPUSH_TOKEN
    ? ' HOTCODEPUSH_TOKEN still authenticates.'
    : '';
  if (endedSession.id === null && endedSession.name === null) {
    console.log(`No stored session to end.${variableText}`);
    return;
  }
  const nameText = endedSession.name === null ? '' : ` ${endedSession.name}`;
  console.log(`Logged out${nameText}.${variableText}`);
}

/**
 * A bearer can be the signed form, `<token>.<signature>`, while revoke-session looks the session up by the token alone.
 */
function resolveUnsignedToken(token: string): string {
  const [unsignedToken = token] = token.split('.');
  return unsignedToken;
}
