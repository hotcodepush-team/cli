import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveConsoleBaseUrl,
  resolveDeviceHosts,
  resolveFilesBaseUrl,
} from './hosts.js';

describe('hosts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should write no hosts for the production API', () => {
    expect(resolveDeviceHosts('https://api.hotcodepush.com')).toEqual({
      filesBaseUrl: undefined,
      updatesBaseUrl: undefined,
    });
    expect(resolveFilesBaseUrl('https://api.hotcodepush.com')).toBe(
      'https://files.hotcodepush.com',
    );
  });

  it('should map the staging API to the staging hosts', () => {
    expect(resolveDeviceHosts('https://api.staging.hotcodepush.com/')).toEqual({
      filesBaseUrl: 'https://files.staging.hotcodepush.com',
      updatesBaseUrl: 'https://updates.staging.hotcodepush.com',
    });
  });

  it('should serve the hosts from any other API itself', () => {
    expect(resolveDeviceHosts('http://localhost:8787')).toEqual({
      filesBaseUrl: 'http://localhost:8787/files',
      updatesBaseUrl: 'http://localhost:8787/updates',
    });
  });

  it('should let the environment override each host, for an emulator reaching the host machine', () => {
    vi.stubEnv('HOTCODEPUSH_FILES_BASE_URL', 'http://10.0.2.2:8787/files');
    expect(resolveDeviceHosts('http://localhost:8787')).toEqual({
      filesBaseUrl: 'http://10.0.2.2:8787/files',
      updatesBaseUrl: 'http://localhost:8787/updates',
    });
  });

  it('should derive the console from the API URL, the local console for the local stack, the variable winning', () => {
    expect(resolveConsoleBaseUrl('https://api.hotcodepush.com')).toBe(
      'https://console.hotcodepush.com',
    );
    expect(resolveConsoleBaseUrl('https://api.staging.hotcodepush.com/')).toBe(
      'https://console.staging.hotcodepush.com',
    );
    expect(resolveConsoleBaseUrl('http://localhost:8787')).toBe(
      'http://localhost:4300',
    );
    vi.stubEnv('HOTCODEPUSH_CONSOLE_BASE_URL', 'http://console.local');
    expect(resolveConsoleBaseUrl('https://api.hotcodepush.com')).toBe(
      'http://console.local',
    );
  });
});
