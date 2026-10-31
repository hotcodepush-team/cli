import { DEFAULT_API_URL } from '../config/consts.js';

// Written into the resource file only outside production.
export interface DeviceHosts {
  filesBaseUrl: string | undefined;
  updatesBaseUrl: string | undefined;
}

const LOCAL_CONSOLE_BASE_URL = 'http://localhost:4300';
const PRODUCTION_CONSOLE_BASE_URL = 'https://console.hotcodepush.com';
const PRODUCTION_FILES_BASE_URL = 'https://files.hotcodepush.com';
const PRODUCTION_UPDATES_BASE_URL = 'https://updates.hotcodepush.com';
const STAGING_API_URL = 'https://api.staging.hotcodepush.com';
const STAGING_CONSOLE_BASE_URL = 'https://console.staging.hotcodepush.com';
const STAGING_FILES_BASE_URL = 'https://files.staging.hotcodepush.com';
const STAGING_UPDATES_BASE_URL = 'https://updates.staging.hotcodepush.com';

// Any API other than production and staging is the local stack, which serves the hosts itself.
export function resolveDeviceHosts(apiUrl: string): DeviceHosts {
  const derived = resolveDerivedDeviceHosts(apiUrl);
  return {
    filesBaseUrl:
      process.env.HOTCODEPUSH_FILES_BASE_URL || derived.filesBaseUrl,
    updatesBaseUrl:
      process.env.HOTCODEPUSH_UPDATES_BASE_URL || derived.updatesBaseUrl,
  };
}

// The local console runs on the dev port of the monorepo.
export function resolveConsoleBaseUrl(apiUrl: string): string {
  if (process.env.HOTCODEPUSH_CONSOLE_BASE_URL) {
    return process.env.HOTCODEPUSH_CONSOLE_BASE_URL;
  }
  const trimmedApiUrl = apiUrl.replace(/\/+$/, '');
  if (trimmedApiUrl === DEFAULT_API_URL) {
    return PRODUCTION_CONSOLE_BASE_URL;
  }
  return trimmedApiUrl === STAGING_API_URL
    ? STAGING_CONSOLE_BASE_URL
    : LOCAL_CONSOLE_BASE_URL;
}

// The production host applies where the resource file names none.
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
