import { readFileSync } from 'node:fs';
import { ConfigurationSchema } from '@hotcodepush/protocol';
import { describe, expect, it } from 'vitest';
import { CAPACITOR_FINGERPRINT } from '../../test/capacitor-project.js';
import { resolveProtocolSigningKey, SIGNING_KEY } from '../../test/fixtures.js';
import { InvalidParameterError } from './errors.js';
import { buildResourceFile } from './resource-file.js';
import type { Platform } from './upload.js';

const CHANNEL_ID = '83ae07ef-2539-4c88-8380-17a56e24a82f';

const UNREGISTERED_BUNDLE = {
  bundleVersion: '1.0',
  files: [
    {
      filePath: '/build/index.html',
      path: 'index.html',
      sha256: 'a'.repeat(64),
      sizeBytes: 11,
    },
  ],
  id: null,
};

interface DevicePublicKeysCase {
  devicePublicKeys: Record<Platform, { der: string; keyId: string }[]>;
  publicKeys: string[];
}

// The protocol's cases list each key as the project file holds it and as each platform reads it
const [DEVICE_PUBLIC_KEYS_CASE] = (
  JSON.parse(
    readFileSync(
      new URL(
        '../../node_modules/@hotcodepush/protocol/fixtures/signatures.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { manifests: DevicePublicKeysCase[] }
).manifests.filter(({ publicKeys }) => publicKeys.length === 3);

function buildResourceFileWithPublicKeys(
  platform: Platform,
  publicKeys: string[],
): ReturnType<typeof buildResourceFile> {
  return buildResourceFile({
    builtAt: '2026-09-29T12:00:00.000Z',
    channelId: CHANNEL_ID,
    embeddedBundle: UNREGISTERED_BUNDLE,
    fingerprint: CAPACITOR_FINGERPRINT,
    hosts: { filesBaseUrl: undefined, updatesBaseUrl: undefined },
    platform,
    projectConfig: {
      appId: 'ec266350-15f9-44c6-9d85-82f1363ede75',
      publicKeys,
    },
  });
}

describe('resource file', () => {
  it('should carry the configuration with its defaults and the resolved channel id, the floor, the fingerprint, the files-only manifest and the hosts', () => {
    const resourceFile = buildResourceFile({
      builtAt: '2026-09-29T12:00:00.000Z',
      channelId: CHANNEL_ID,
      embeddedBundle: UNREGISTERED_BUNDLE,
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
      channelId: CHANNEL_ID,
      embeddedBundle: {
        ...UNREGISTERED_BUNDLE,
        id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
      },
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

  it('should write a null manifest and a null bundle id when the build embeds no bundle', () => {
    const resourceFile = buildResourceFile({
      builtAt: '2026-09-29T12:00:00.000Z',
      channelId: null,
      embeddedBundle: null,
      fingerprint: CAPACITOR_FINGERPRINT,
      hosts: { filesBaseUrl: undefined, updatesBaseUrl: undefined },
      platform: 'ios',
      projectConfig: { appId: 'ec266350-15f9-44c6-9d85-82f1363ede75' },
    });

    expect(resourceFile).toMatchObject({
      embeddedBundleId: null,
      embeddedBundleManifest: null,
      fingerprint: CAPACITOR_FINGERPRINT,
    });
  });

  it.each<[Platform, string]>([
    ['ios', 'PKCS #1'],
    ['android', 'SPKI'],
  ])(
    'should write the public keys of an %s build as %s DER beside their key ids, as the protocol fixtures hold them',
    platform => {
      const resourceFile = buildResourceFileWithPublicKeys(
        platform,
        DEVICE_PUBLIC_KEYS_CASE?.publicKeys ?? [],
      );

      expect(resourceFile.publicKeys).toHaveLength(3);
      expect(resourceFile.publicKeys).toEqual(
        DEVICE_PUBLIC_KEYS_CASE?.devicePublicKeys[platform],
      );
      expect(resourceFile.publicKeys.map(({ keyId }) => keyId)).toContain(
        SIGNING_KEY.fingerprint,
      );
    },
  );

  it.each([
    [
      'under another scheme',
      'ed25519:NYn5qxMGX39y0hB0UZzOG8KFtzCesZ+/dRZQBTFeCz4=',
    ],
    ['that is no key', 'rsa-v1_5-sha256:AQID'],
    ['under 2048 bits', resolveProtocolSigningKey('rsa-1024').publicKey],
  ])(
    'should stop with E_INVALID_PARAMETER naming publicKeys for a key %s',
    (_condition, publicKey) => {
      expect(() => buildResourceFileWithPublicKeys('ios', [publicKey])).toThrow(
        InvalidParameterError,
      );
    },
  );
});
