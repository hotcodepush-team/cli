import { DEFAULT_API_URL } from '../config/consts.js';

/**
 * The hosts a device reads from and reports to, written into the resource file only outside production.
 */
export interface DeviceHosts {
  filesBaseUrl: string | undefined;
  updatesBaseUrl: string | undefined;
}

const PRODUCTION_FILES_BASE_URL = 'https://files.hotcodepush.com';
const PRODUCTION_UPDATES_BASE_URL = 'https://updates.hotcodepush.com';
const STAGING_API_URL = 'https://api.staging.hotcodepush.com';
const STAGING_FILES_BASE_URL = 'https://files.staging.hotcodepush.com';
const STAGING_UPDATES_BASE_URL = 'https://updates.staging.hotcodepush.com';

/**
 * The device hosts derived from the CLI's API URL: production writes none, the staging API maps to the staging hosts,
 * any other API — the local stack — serves them itself under `/files` and `/updates`; the two environment variables override per build.
 */
export function resolveDeviceHosts(apiUrl: string): DeviceHosts {
  const derived = resolveDerivedDeviceHosts(apiUrl);
  return {
    filesBaseUrl:
      process.env.HOTCODEPUSH_FILES_BASE_URL || derived.filesBaseUrl,
    updatesBaseUrl:
      process.env.HOTCODEPUSH_UPDATES_BASE_URL || derived.updatesBaseUrl,
  };
}

/**
 * The files host a bundle's manifest is read from, the production host where the resource file names none.
 */
export function resolveFilesBaseUrl(apiUrl: string): string {
  return resolveDeviceHosts(apiUrl).filesBaseUrl ?? PRODUCTION_FILES_BASE_URL;
}

export function resolveUpdatesBaseUrl(apiUrl: string): string {
  return (
    resolveDeviceHosts(apiUrl).updatesBaseUrl ?? PRODUCTION_UPDATES_BASE_URL
  );
}

function resolveDerivedDeviceHosts(apiUrl: string): DeviceHosts {
  const trimmedApiUrl = apiUrl.replace(/\/+$/, '');
  if (trimmedApiUrl === DEFAULT_API_URL) {
    return { filesBaseUrl: undefined, updatesBaseUrl: undefined };
  }
  if (trimmedApiUrl === STAGING_API_URL) {
    return {
      filesBaseUrl: STAGING_FILES_BASE_URL,
      updatesBaseUrl: STAGING_UPDATES_BASE_URL,
    };
  }
  return {
    filesBaseUrl: `${trimmedApiUrl}/files`,
    updatesBaseUrl: `${trimmedApiUrl}/updates`,
  };
}
