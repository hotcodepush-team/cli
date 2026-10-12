import { HotCodePushError } from '@hotcodepush/node';
import type { User } from '@hotcodepush/node';
import { createApiClient } from './api-client.js';

const UNAUTHENTICATED_STATUS = 401;

/**
 * The user behind the credential as `GET /v1/users/me` answers it; a bearer the API refuses is its own
 * E_UNAUTHENTICATED, passed through as every API error is.
 */
export async function fetchCurrentUser(): Promise<User> {
  return createApiClient().users.get({ userId: 'me' });
}

/**
 * Whether the API refused the bearer, the case a command treats as not logged in rather than as a failure.
 */
export function isUnauthenticatedError(error: unknown): boolean {
  return (
    error instanceof HotCodePushError && error.status === UNAUTHENTICATED_STATUS
  );
}

/**
 * The credential in one sentence: `Logged in as Anna (anna@example.com).`, or the token variable when that is what the CLI sent.
 */
export function resolveCredentialText(
  user: User,
  isEnvironmentToken: boolean,
): string {
  const who = `${user.name} (${user.email})`;
  return isEnvironmentToken
    ? `Authenticated with HOTCODEPUSH_TOKEN as ${who}.`
    : `Logged in as ${who}.`;
}
