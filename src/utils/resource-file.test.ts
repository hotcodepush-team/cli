import { ConfigurationSchema } from '@hotcodepush/protocol';
import { describe, expect, it } from 'vitest';
import { CAPACITOR_FINGERPRINT } from '../../test/capacitor-project.js';
import { buildResourceFile } from './resource-file.js';

const CHANNEL_ID = '83ae07ef-2539-4c88-8380-17a56e24a82f';

const FILES = [
  {
    filePath: '/build/index.html',
    path: 'index.html',
    sha256: 'a'.repeat(64),
    sizeBytes: 11,
  },
];

describe('resource file', () => {
  it('should carry the configuration with its defaults and the resolved channel id, the floor, the fingerprint, the files-only manifest and the hosts', () => {
    const resourceFile = buildResourceFile({
      builtAt: '2026-09-29T12:00:00.000Z',
      bundleVersion: '1.0',
      channelId: CHANNEL_ID,
      embeddedBundleId: null,
      files: FILES,
      fingerprint: CAPACITOR_FINGERPRINT,
      hosts: {
        filesBaseUrl: 'http://localhost:8787/files',
        updatesBaseUrl: 'http://localhost:8787/updates',
      },
      platform: 'ios',
      projectConfig: {
        appId: 'ec266350-15f9-44c6-9d85-82f1363ede75',
        channel: 'production',
        dir: 'dist',
      },
    });

    expect(ConfigurationSchema.parse(resourceFile)).toEqual(resourceFile);
    expect(resourceFile).toEqual({
      appId: 'ec266350-15f9-44c6-9d85-82f1363ede75',
      autoCheck: true,
      builtAt: '2026-09-29T12:00:00.000Z',
      channelId: CHANNEL_ID,
      checkInterval: 900,
      dir: 'dist',
      downloadStrategy: 'auto',
      embeddedBundleId: null,
      embeddedBundleManifest: {
        appId: 'ec266350-15f9-44c6-9d85-82f1363ede75',
        bundleVersion: '1.0',
        files: [{ path: 'index.html', sha256: 'a'.repeat(64), sizeBytes: 11 }],
        fingerprint: CAPACITOR_FINGERPRINT,
        keyId: null,
        platforms: ['ios'],
      },
      enabledInDebugBuilds: true,
      filesBaseUrl: 'http://localhost:8787/files',
      fingerprint: CAPACITOR_FINGERPRINT,
      installOnResumeAfter: 300,
      installStrategy: 'next-start',
      mandatoryInstallStrategy: 'immediate',
      publicKeys: [],
      readySignal: 'render',
      readyTimeout: 10,
      updatesBaseUrl: 'http://localhost:8787/updates',
    });
  });

  it('should keep the configured SDK options, replace the channel by the resolved id and write no hosts for production', () => {
    const resourceFile = buildResourceFile({
      builtAt: '2026-09-29T12:00:00.000Z',
      bundleVersion: '1.0',
      channelId: CHANNEL_ID,
      embeddedBundleId: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
      files: FILES,
      fingerprint: CAPACITOR_FINGERPRINT,
      hosts: { filesBaseUrl: undefined, updatesBaseUrl: undefined },
      platform: 'android',
      projectConfig: {
        appId: 'ec266350-15f9-44c6-9d85-82f1363ede75',
        channel: 'staging',
        installStrategy: 'next-resume',
      },
    });

    expect(resourceFile.channelId).toBe(CHANNEL_ID);
    expect(resourceFile).not.toHaveProperty('channel');
    expect(resourceFile.installStrategy).toBe('next-resume');
    expect(resourceFile.embeddedBundleId).toBe(
      'c56a4180-65aa-42ec-a945-5fd21dec0538',
    );
    expect(resourceFile).not.toHaveProperty('filesBaseUrl');
  });
});
