import { HotCodePush } from '@hotcodepush/node';
import { PACKAGE_JSON } from '../config/consts.js';
import { NotLoggedInError } from './errors.js';
import { readToken } from './token-store.js';
import { readApiUrl } from './user-config.js';

/**
 * The typed client of the REST API with the token of `readToken()`; without one, the command is not logged in.
 */
export function createApiClient(): HotCodePush {
  const token = readToken();
  if (token === undefined) {
    throw new NotLoggedInError();
  }
  return new HotCodePush({
    baseUrl: readApiUrl(),
    client: `cli/${PACKAGE_JSON.version}`,
    token,
  });
}
