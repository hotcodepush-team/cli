import { Entry } from '@napi-rs/keyring';
import {
  KEYRING_ACCOUNT_NAME,
  KEYRING_SERVICE_NAME,
} from '../config/consts.js';
import { readUserConfig, writeUserConfig } from './user-config.js';

// Set by the first keyring failure, e.g. a headless CI with an unusable Secret Service: from then on `config.json`
// is the one source for the rest of the process, so a read never returns a stale keyring token after a failed write
let hasKeyringFailed = false;

export function deleteToken(): void {
  if (!hasKeyringFailed) {
    try {
      createKeyringEntry().deletePassword();
    } catch {
      hasKeyringFailed = true;
    }
  }
  deleteUserConfigToken();
}

/**
 * The token: `HOTCODEPUSH_TOKEN` when set, otherwise the stored one.
 */
export function readToken(): string | undefined {
  return process.env.HOTCODEPUSH_TOKEN || readStoredToken();
}

/**
 * The session token `login` stored, the keyring's or the fallback in `config.json`, whatever the environment carries.
 */
export function readStoredToken(): string | undefined {
  return readKeyringToken() || readUserConfig().token;
}

export function writeToken(token: string): void {
  if (!hasKeyringFailed) {
    try {
      createKeyringEntry().setPassword(token);
      deleteUserConfigToken();
      return;
    } catch {
      hasKeyringFailed = true;
    }
  }
  writeUserConfig({ ...readUserConfig(), token });
}

function createKeyringEntry(): Entry {
  return new Entry(KEYRING_SERVICE_NAME, KEYRING_ACCOUNT_NAME);
}

function deleteUserConfigToken(): void {
  const userConfig = readUserConfig();
  if (userConfig.token === undefined) {
    return;
  }
  delete userConfig.token;
  writeUserConfig(userConfig);
}

function readKeyringToken(): string | undefined {
  if (hasKeyringFailed) {
    return undefined;
  }
  try {
    return createKeyringEntry().getPassword() ?? undefined;
  } catch {
    hasKeyringFailed = true;
    return undefined;
  }
}
