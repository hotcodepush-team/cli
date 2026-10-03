import { ConfigurationSchema } from '@hotcodepush/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildResourceFile, UNREGISTERED_BUNDLE_ID } from './resource-file.js';

const FILES = [
  {
    filePath: '/build/index.html',
    path: 'index.html',
    sha256: 'a'.repeat(64),
    sizeBytes: 11,
  },
];

describe('resource file', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should carry the configuration with its defaults, the floor, the files-only manifest and the hosts', () => {
    const resourceFile = buildResourceFile({
      builtAt: '2026-09-29T12:00:00.000Z',
      embeddedBundleId: null,
      files: FILES,
      hosts: {
        filesBaseUrl: 'http://localhost:8787/files',
        updatesBaseUrl: 'http://localhost:8787/updates',
      },
      projectConfig: {
        appId: 'ec266350-15f9-44c6-9d85-82f1363ede75',
        channelId: '83ae07ef-2539-4c88-8380-17a56e24a82f',
        dir: 'dist',
      },
      version: '1.0',
    });

    expect(ConfigurationSchema.parse(resourceFile)).toEqual(resourceFile);
    expect(resourceFile).toMatchObject({
      autoCheck: true,
      builtAt: '2026-09-29T12:00:00.000Z',
      channelId: '83ae07ef-2539-4c88-8380-17a56e24a82f',
      checkInterval: 900,
      embeddedBundleId: null,
      embeddedBundleManifest: {
        bundleId: UNREGISTERED_BUNDLE_ID,
        deltas: [],
        files: [{ path: 'index.html', sha256: 'a'.repeat(64), sizeBytes: 11 }],
        pack: null,
        patches: [],
        version: '1.0',
      },
      filesBaseUrl: 'http://localhost:8787/files',
      fingerprint: null,
      updatesBaseUrl: 'http://localhost:8787/updates',
    });
  });

  it('should apply HOTCODEPUSH_CHANNEL_ID over the configured channel and write no hosts for production', () => {
    vi.stubEnv(
      'HOTCODEPUSH_CHANNEL_ID',
      '9b2f4d1e-3c5a-4e6f-8a7b-1c2d3e4f5a6b',
    );

    const resourceFile = buildResourceFile({
      builtAt: '2026-09-29T12:00:00.000Z',
      embeddedBundleId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
      files: FILES,
      hosts: { filesBaseUrl: undefined, updatesBaseUrl: undefined },
      projectConfig: {
        appId: 'ec266350-15f9-44c6-9d85-82f1363ede75',
        channelId: '83ae07ef-2539-4c88-8380-17a56e24a82f',
      },
      version: '1.0',
    });

    expect(resourceFile.channelId).toBe('9b2f4d1e-3c5a-4e6f-8a7b-1c2d3e4f5a6b');
    expect(resourceFile.embeddedBundleManifest.bundleId).toBe(
      'c56a4180-65aa-42ec-a945-5fd21dec0538',
    );
    expect(resourceFile).not.toHaveProperty('filesBaseUrl');
  });
});
