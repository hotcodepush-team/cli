import { Entry } from '@napi-rs/keyring';
import {
  KEYRING_ACCOUNT_NAME,
  KEYRING_SERVICE_NAME,
} from '../config/consts.js';
import { readUserConfig, writeUserConfig } from './user-config.js';

// Set by the first keyring failure, such as a headless CI without a usable Secret Service.
// From then on only `config.json` is used, so a read never returns a stale keyring token after a failed write.
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

export function isEnvironmentToken(): boolean {
  return Boolean(process.env.HOTCODEPUSH_TOKEN);
}

export function readToken(): string | undefined {
  return process.env.HOTCODEPUSH_TOKEN || readStoredToken();
}

// Ignores `HOTCODEPUSH_TOKEN`.
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
