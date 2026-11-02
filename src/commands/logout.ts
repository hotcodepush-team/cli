import type { AuthClient } from '../utils/auth-client.js';
import { createApiAuthClient } from '../utils/auth-client.js';
import { defineCommand } from '../utils/command.js';
import { printNotice } from '../utils/diagnostics.js';
import { resolveApiError } from '../utils/error-mapping.js';
import { NotLoggedInError } from '../utils/errors.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson, printResult } from '../utils/output.js';
import { deleteToken, readStoredToken } from '../utils/token-store.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';

interface EndedSession {
  id: string | null;
  name: string | null;
}

const UNAUTHORIZED_STATUS = 401;

export default defineCommand({
  description:
    'End the stored session and remove its token. HOTCODEPUSH_TOKEN, when set, stays what it is.',
  authentication: 'optional',
  examples: ['hotcodepush logout', 'hotcodepush logout --json'],
  options: defineCommandOptions({}),
  action: async options => {
    const endedSession = await endStoredSession();
    if (options.json) {
      printJson(endedSession);
      return;
    }
    printEnded(endedSession);
  },
});

// Without a stored session there is nothing to end, and the variable alone is no session.
async function endStoredSession(): Promise<EndedSession> {
  const storedToken = readStoredToken();
  if (storedToken === undefined) {
    if (!process.env.HOTCODEPUSH_TOKEN) {
      throw new NotLoggedInError();
    }
    return { id: null, name: null };
  }
  const authClient = createApiAuthClient(storedToken);
  const knownSession = await fetchKnownSession(authClient);
  const { error } = await authClient.revokeSession({
    token: resolveUnsignedToken(storedToken),
  });
  // A 401 means the session already ended, so only the stored copies are left to clear.
  if (error !== null && error.status !== UNAUTHORIZED_STATUS) {
    throw resolveApiError(error);
  }
  deleteToken();
  const storedSessionId = deleteStoredSession();
  return {
    id: knownSession?.session.id ?? storedSessionId ?? null,
    name: knownSession?.user.name ?? null,
  };
}

function deleteStoredSession(): string | undefined {
  const userConfig = readUserConfig();
  const { sessionId } = userConfig;
  if (sessionId === undefined && userConfig.sessionExpiresAt === undefined) {
    return undefined;
  }
  delete userConfig.sessionExpiresAt;
  delete userConfig.sessionId;
  writeUserConfig(userConfig);
  return sessionId;
}

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

function printEnded(endedSession: EndedSession): void {
  printResult({
    rows: endedSession.id === null ? [] : [['ID', endedSession.id]],
    sentence: resolveEndedText(endedSession),
  });
  if (process.env.HOTCODEPUSH_TOKEN) {
    printNotice('HOTCODEPUSH_TOKEN still authenticates.');
  }
}

function resolveEndedText(endedSession: EndedSession): string {
  if (endedSession.id === null && endedSession.name === null) {
    return 'No stored session to end.';
  }
  const nameText = endedSession.name === null ? '' : ` ${endedSession.name}`;
  return `Logged out${nameText}.`;
}

// A bearer can be signed, `<token>.<signature>`, but revoke-session looks up the token alone.
function resolveUnsignedToken(token: string): string {
  const [unsignedToken = token] = token.split('.');
  return unsignedToken;
}
