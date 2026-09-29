import { HotCodePushError } from '@hotcodepush/node';
import { createApiClient } from './api-client.js';
import { createApiAuthClient, fetchSession } from './auth-client.js';
import { NotLoggedInError } from './errors.js';
import { readToken } from './token-store.js';

/**
 * What the CLI acts with, as the API confirmed it: a session names its user, an API token only itself.
 */
export interface Credential {
  description: string;
  kind: 'session' | 'token';
}

const UNAUTHENTICATED_STATUS = 401;

/**
 * The credential checked against the API: the session of the stored token, or `HOTCODEPUSH_TOKEN`, an API token
 * no session answers for, validated through a request every credential can make. Neither is not logged in.
 */
export async function fetchCredential(): Promise<Credential> {
  const token = readToken();
  if (token === undefined) {
    throw new NotLoggedInError();
  }
  try {
    const { user } = await fetchSession(createApiAuthClient(token));
    return {
      description: `logged in as ${user.name} (${user.email})`,
      kind: 'session',
    };
  } catch (error) {
    if (!(error instanceof NotLoggedInError)) {
      throw error;
    }
  }
  try {
    await createApiClient().organizations.list({ limit: 1 });
  } catch (error) {
    if (
      error instanceof HotCodePushError &&
      error.status === UNAUTHENTICATED_STATUS
    ) {
      throw new NotLoggedInError();
    }
    throw error;
  }
  return {
    description: process.env.HOTCODEPUSH_TOKEN
      ? 'authenticated with HOTCODEPUSH_TOKEN'
      : 'authenticated with an API token',
    kind: 'token',
  };
}
