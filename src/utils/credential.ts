import { HotCodePushError } from '@hotcodepush/node';
import type { User } from '@hotcodepush/node';
import { createApiClient } from './api-client.js';

const UNAUTHENTICATED_STATUS = 401;

export async function fetchCurrentUser(): Promise<User> {
  return createApiClient().users.get({ userId: 'me' });
}

export function isUnauthenticatedError(error: unknown): boolean {
  return (
    error instanceof HotCodePushError && error.status === UNAUTHENTICATED_STATUS
  );
}

export function resolveCredentialText(
  user: User,
  isEnvironmentToken: boolean,
): string {
  const who = `${user.name} (${user.email})`;
  return isEnvironmentToken
    ? `Authenticated with HOTCODEPUSH_TOKEN as ${who}.`
    : `Logged in as ${who}.`;
}
