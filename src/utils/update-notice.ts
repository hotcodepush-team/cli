import { PACKAGE_JSON } from '../config/consts.js';
import { isCi } from './environment.js';
import { readUserConfig, writeUserConfig } from './user-config.js';

const LATEST_VERSION_URL = `https://registry.npmjs.org/${PACKAGE_JSON.name}/latest`;

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const UPDATE_CHECK_TIMEOUT_MS = 1000;

// major, minor and patch; a prerelease suffix is not compared
const VERSION_CORE_PATTERN = /^\d+\.\d+\.\d+/;

/**
 * Whether one version is above another by major, minor and patch.
 */
export function isNewerVersion(
  candidateVersion: string,
  currentVersion: string,
): boolean {
  const candidateCore = VERSION_CORE_PATTERN.exec(candidateVersion)?.[0];
  const currentCore = VERSION_CORE_PATTERN.exec(currentVersion)?.[0];
  if (candidateCore === undefined || currentCore === undefined) {
    return false;
  }
  return candidateCore.localeCompare(currentCore, 'en', { numeric: true }) > 0;
}

/**
 * The one line after a command once the cache knows a newer version, on stderr so `--json` stays data.
 */
export function printUpdateNotice(): void {
  if (!isUpdateNoticeEnabled()) {
    return;
  }
  try {
    const { latestKnownVersion } = readUserConfig();
    if (
      latestKnownVersion !== undefined &&
      isNewerVersion(latestKnownVersion, PACKAGE_JSON.version)
    ) {
      process.stderr.write(
        `HotCodePush CLI ${latestKnownVersion} is available; you run ${PACKAGE_JSON.version}.\n`,
      );
    }
  } catch {
    // a config.json the CLI cannot read is the command's to report, never the notice's
  }
}

/**
 * Asks the npm registry for the newest version at most once a day and keeps the answer in config.json. A failed check
 * waits a day too, so a machine offline is not asked on every command, and nothing here ever fails one.
 */
export async function refreshLatestKnownVersion(): Promise<void> {
  if (!isUpdateNoticeEnabled()) {
    return;
  }
  try {
    const { lastUpdateCheckAt } = readUserConfig();
    if (
      lastUpdateCheckAt !== undefined &&
      Date.now() - Date.parse(lastUpdateCheckAt) < UPDATE_CHECK_INTERVAL_MS
    ) {
      return;
    }
    const latestVersion = await fetchLatestVersion();
    // read again: the command may have written config.json while the request ran
    writeUserConfig({
      ...readUserConfig(),
      lastUpdateCheckAt: new Date().toISOString(),
      ...(latestVersion !== undefined && { latestKnownVersion: latestVersion }),
    });
  } catch {
    // a config.json the CLI cannot read or write is the command's to report, never the notice's
  }
}

async function fetchLatestVersion(): Promise<string | undefined> {
  try {
    const response = await fetch(LATEST_VERSION_URL, {
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    });
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Never in CI, where nobody updates from a log line, and never under `HOTCODEPUSH_NO_UPDATE_NOTIFIER=1`.
 */
function isUpdateNoticeEnabled(): boolean {
  return !isCi() && process.env.HOTCODEPUSH_NO_UPDATE_NOTIFIER !== '1';
}
