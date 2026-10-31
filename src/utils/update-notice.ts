import { PACKAGE_JSON } from '../config/consts.js';
import { isCi } from './environment.js';
import {
  ignoreUserConfigErrors,
  readUserConfig,
  writeUserConfig,
} from './user-config.js';

const LATEST_VERSION_URL = `https://registry.npmjs.org/${PACKAGE_JSON.name}/latest`;

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const UPDATE_CHECK_TIMEOUT_MS = 1000;

// Matches major, minor and patch. A prerelease suffix is not compared.
const VERSION_CORE_PATTERN = /^\d+\.\d+\.\d+/;

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

export function printUpdateNotice(): void {
  if (!isUpdateNoticeEnabled()) {
    return;
  }
  ignoreUserConfigErrors(() => {
    const { latestKnownVersion } = readUserConfig();
    if (
      latestKnownVersion !== undefined &&
      isNewerVersion(latestKnownVersion, PACKAGE_JSON.version)
    ) {
      process.stderr.write(
        `HotCodePush CLI ${latestKnownVersion} is available; you run ${PACKAGE_JSON.version}.\n`,
      );
    }
  });
}

// A failed check also waits a day, so an offline machine is not asked on every command.
export async function refreshLatestKnownVersion(): Promise<void> {
  if (!isUpdateNoticeEnabled()) {
    return;
  }
  const isCheckedRecently = ignoreUserConfigErrors(() => {
    const { lastUpdateCheckAt } = readUserConfig();
    return (
      lastUpdateCheckAt !== undefined &&
      Date.now() - Date.parse(lastUpdateCheckAt) < UPDATE_CHECK_INTERVAL_MS
    );
  });
  if (isCheckedRecently !== false) {
    return;
  }
  const latestVersion = await fetchLatestVersion();
  ignoreUserConfigErrors(() => {
    // Read again, since the command may have written config.json during the request.
    writeUserConfig({
      ...readUserConfig(),
      lastUpdateCheckAt: new Date().toISOString(),
      ...(latestVersion !== undefined && { latestKnownVersion: latestVersion }),
    });
  });
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

// Nobody updates from a CI log line.
function isUpdateNoticeEnabled(): boolean {
  return !isCi() && process.env.HOTCODEPUSH_UPDATE_NOTICE_DISABLED !== '1';
}
