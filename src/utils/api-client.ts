import { HotCodePush } from '@hotcodepush/node';
import { PACKAGE_JSON, USER_AGENT } from '../config/consts.js';
import { NotLoggedInError } from './errors.js';
import { readToken } from './token-store.js';
import { readApiUrl } from './user-config.js';

export function createApiClient(): HotCodePush {
  const token = readToken();
  if (token === undefined) {
    throw new NotLoggedInError();
  }
  return new HotCodePush({
    baseUrl: readApiUrl(),
    client: `cli/${PACKAGE_JSON.version}`,
    token,
    userAgent: USER_AGENT,
  });
}
