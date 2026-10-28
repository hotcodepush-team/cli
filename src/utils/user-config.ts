import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIG_DIRECTORY_NAME,
  CONFIG_FILE_NAME,
  DEFAULT_API_URL,
} from '../config/consts.js';
import { readJsonFile } from './json-file.js';

/**
 * `config.json` in the user's config directory; the token is here only where no keyring backend works,
 * and the pending device authorization only between a non-interactive login and the next one.
 */
export interface UserConfig {
  apiUrl?: string;
  lastUpdateCheckAt?: string;
  latestKnownVersion?: string;
  pendingDeviceCode?: string;
  pendingDeviceCodeExpiresAt?: string;
  pendingUserCode?: string;
  pendingVerificationUrl?: string;
  sessionId?: string;
  telemetryNoticeShownAt?: string;
  token?: string;
}

/**
 * `HOTCODEPUSH_API_URL` when set, so a CI reaches the API its `HOTCODEPUSH_TOKEN` belongs to, then the URL `login --api-url` stored; an empty variable is unset.
 */
export function readApiUrl(): string {
  return (
    process.env.HOTCODEPUSH_API_URL ||
    readUserConfig().apiUrl ||
    DEFAULT_API_URL
  ).replace(/\/+$/, '');
}

export function readUserConfig(): UserConfig {
  const filePath = resolveConfigFilePath();
  if (!existsSync(filePath)) {
    return {};
  }
  return readJsonFile(filePath) as UserConfig;
}

/**
 * `~/.config/hotcodepush` on macOS and Linux, `$XDG_CONFIG_HOME` honoured; `%APPDATA%\hotcodepush` on Windows.
 */
export function resolveConfigDirectoryPath(): string {
  const baseDirectoryPath =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(baseDirectoryPath, CONFIG_DIRECTORY_NAME);
}

export function writeUserConfig(userConfig: UserConfig): void {
  const filePath = resolveConfigFilePath();
  mkdirSync(resolveConfigDirectoryPath(), { recursive: true });
  // The file can hold the token, so only its owner may read it: the mode covers a new file, chmod an existing one
  writeFileSync(filePath, `${JSON.stringify(userConfig, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(filePath, 0o600);
}

function resolveConfigFilePath(): string {
  return join(resolveConfigDirectoryPath(), CONFIG_FILE_NAME);
}
