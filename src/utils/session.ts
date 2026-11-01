import { createApiAuthClient, fetchSession } from './auth-client.js';
import { printSuccess, printWarning } from './diagnostics.js';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { CliError, ExitCode, NotLoggedInError } from './errors.js';
import { promptYesNo } from './prompts.js';
import {
  isEnvironmentToken,
  readStoredToken,
  readToken,
} from './token-store.js';
import { readUserConfig, writeStoredSession } from './user-config.js';

// A command that runs without a session exports `sessionRequirement = 'optional'`; every other command gets one before it runs.
export type SessionRequirement = 'optional' | 'required';

export type SessionState = 'expired' | 'missing' | 'usable';

// The session is a precondition of the command, never an error inside it, so nothing is retried.
// A non-interactive run cannot log in, so it checks only that a token exists and leaves its validity to the API.
export async function ensureSession(
  options: InteractivityOptions,
): Promise<void> {
  if (!isInteractive(options)) {
    if (readToken() === undefined) {
      throw new NotLoggedInError();
    }
    return;
  }
  const sessionState = await readSessionState();
  if (sessionState === 'usable') {
    return;
  }
  printWarning(
    sessionState === 'expired'
      ? 'Your session has expired.'
      : 'You are not logged in.',
  );
  if (!(await promptYesNo('Log in now?', options))) {
    throw new NotLoggedInError();
  }
  // Loaded here, so a command line that needs no login never loads the auth client.
  const { logIn } = await import('../commands/login.js');
  const user = await logIn(options);
  printSuccess(`Logged in as ${user.name} (${user.email}).`);
}

// `HOTCODEPUSH_TOKEN` is taken as it is; its validity is the API's to judge.
// A session slides while in use, so a stored expiry that has passed is a hint, checked with one request before anyone is asked.
export async function readSessionState(): Promise<SessionState> {
  if (isEnvironmentToken()) {
    return 'usable';
  }
  const storedToken = readStoredToken();
  if (storedToken === undefined) {
    return 'missing';
  }
  const { sessionExpiresAt } = readUserConfig();
  if (
    sessionExpiresAt === undefined ||
    new Date(sessionExpiresAt) > new Date()
  ) {
    return 'usable';
  }
  return (await refreshStoredSession(storedToken)) ? 'usable' : 'expired';
}

async function refreshStoredSession(storedToken: string): Promise<boolean> {
  try {
    const { session } = await fetchSession(createApiAuthClient(storedToken));
    writeStoredSession(session);
    return true;
  } catch (error) {
    if (error instanceof CliError && error.exitCode === ExitCode.NotLoggedIn) {
      return false;
    }
    throw error;
  }
}
