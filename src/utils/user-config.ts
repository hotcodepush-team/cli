import { chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { read, userConfigDir, write } from 'rc9';
import { CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME } from '../config/consts.js';

/**
 * `config.json` in the user's config directory; the token is here only where no keyring backend works.
 */
export type UserConfig = {
  apiUrl?: string;
  lastUpdateCheckAt?: string;
  latestKnownVersion?: string;
  sessionId?: string;
  telemetryNoticeShownAt?: string;
  token?: string;
};

export function readUserConfig(): UserConfig {
  return read<UserConfig>({
    dir: resolveConfigDirectoryPath(),
    name: CONFIG_FILE_NAME,
  });
}

/**
 * `~/.config/hotcodepush` on macOS and Linux, `$XDG_CONFIG_HOME` honoured; `%APPDATA%\hotcodepush` on Windows.
 */
export function resolveConfigDirectoryPath(): string {
  const baseDirectoryPath =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
      : userConfigDir();
  return join(baseDirectoryPath, CONFIG_DIRECTORY_NAME);
}

export function writeUserConfig(userConfig: UserConfig): void {
  const directoryPath = resolveConfigDirectoryPath();
  write(userConfig, { dir: directoryPath, name: CONFIG_FILE_NAME });
  // The file can hold the token, so only its owner may read it
  chmodSync(join(directoryPath, CONFIG_FILE_NAME), 0o600);
}
