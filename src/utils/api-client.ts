import { HotCodePush } from '@hotcodepush/node';
import { USER_AGENT } from '../config/consts.js';
import { resolveClientHeader } from './environment.js';
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
    client: resolveClientHeader(),
    token,
    userAgent: USER_AGENT,
  });
}
