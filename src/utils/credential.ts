import { HotCodePushError } from '@hotcodepush/node';
import type { User } from '@hotcodepush/node';
import { createApiClient } from './api-client.js';

const UNAUTHENTICATED_STATUS = 401;

/**
 * The user behind the credential as `GET /v1/users/me` answers it, `credential` telling a session from an API token;
 * a bearer the API refuses is its own E_UNAUTHENTICATED, passed through as every API error is.
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
 * The credential in one sentence: `logged in as Anna (anna@example.com)`, or the token variable when that is what authenticates.
 */
export function resolveCredentialText(user: User): string {
  const who = `${user.name} (${user.email})`;
  return user.credential === 'token'
    ? `authenticated with HOTCODEPUSH_TOKEN as ${who}`
    : `logged in as ${who}`;
}
