import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIG_DIRECTORY_NAME,
  CONFIG_FILE_NAME,
  DEFAULT_API_URL,
} from '../config/consts.js';
import { readJsonFile } from './json-file.js';

// The token is stored here only when no keyring backend works.
// The pending device authorization stays only until the next login.
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

// A config.json the CLI cannot read or write is for the command to report, never for a notice.
export function ignoreUserConfigErrors<T>(readOrWrite: () => T): T | undefined {
  try {
    return readOrWrite();
  } catch {
    return undefined;
  }
}

// The variable comes first, so a CI reaches the API its `HOTCODEPUSH_TOKEN` belongs to.
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
  // The file can hold the token, so only its owner may read it.
  // The mode covers a new file and chmod an existing one.
  writeFileSync(filePath, `${JSON.stringify(userConfig, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(filePath, 0o600);
}

function resolveConfigFilePath(): string {
  return join(resolveConfigDirectoryPath(), CONFIG_FILE_NAME);
}
