import { createAuthClient } from 'better-auth/client';
import {
  deviceAuthorizationClient,
  organizationClient,
} from 'better-auth/client/plugins';
import {
  CLIENT_HEADER_NAME,
  PACKAGE_JSON,
  USER_AGENT,
} from '../config/consts.js';
import type { ApiErrorResponse } from './error-mapping.js';
import { resolveApiError } from './error-mapping.js';
import { NotLoggedInError } from './errors.js';
import { readApiUrl } from './user-config.js';

export type AuthClient = ReturnType<typeof createApiAuthClient>;

interface AuthResponse {
  data: unknown;
  error: ApiErrorResponse | null;
}

type AuthResponseData<TResponse> = TResponse extends {
  data: infer TData;
  error: null;
}
  ? TData
  : never;

/**
 * Better Auth's client over the API's `/v1/auth` slice, the bearer only when a token is given:
 * a stale stored token would fail the requests of a login that is about to replace it.
 * The User-Agent names the CLI too: the session row keeps that header, not the client header.
 */
export function createApiAuthClient(token?: string) {
  return createAuthClient({
    baseURL: `${readApiUrl()}/v1/auth`,
    fetchOptions: {
      auth: token === undefined ? undefined : { token, type: 'Bearer' },
      headers: {
        'User-Agent': USER_AGENT,
        [CLIENT_HEADER_NAME]: `cli/${PACKAGE_JSON.version}`,
      },
    },
    plugins: [deviceAuthorizationClient(), organizationClient()],
  });
}

/**
 * The session the client's bearer belongs to; none, an API token for one, counts as not logged in.
 */
export async function fetchSession(authClient: AuthClient) {
  const session = resolveResponseData(await authClient.getSession());
  if (session === null) {
    throw new NotLoggedInError();
  }
  return session;
}

/**
 * The data of a response, or its error thrown as the API answered it.
 */
export function resolveResponseData<TResponse extends AuthResponse>(
  response: TResponse,
): AuthResponseData<TResponse> {
  if (response.error !== null) {
    throw resolveApiError(response.error);
  }
  return response.data as AuthResponseData<TResponse>;
}
