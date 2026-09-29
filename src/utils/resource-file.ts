import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Configuration } from '@hotcodepush/protocol';
import { ConfigurationSchema } from '@hotcodepush/protocol';
import type { BundleFile } from './bundle-files.js';
import type { DeviceHosts } from './hosts.js';
import type { ProjectConfig } from './project-config.js';
import type { Platform } from './upload.js';

interface ResourceFileInput {
  builtAt: string;
  embeddedBundleId: string | null;
  files: BundleFile[];
  hosts: DeviceHosts;
  projectConfig: ProjectConfig;
  version: string;
}

/**
 * The bundle id the resource file carries for a store build the platform never saw: the SDK requires the field, not a value.
 */
export const UNREGISTERED_BUNDLE_ID = 'embedded';

/**
 * The resource file: the project's configuration plus what only a build step can know — the floor, the fingerprint slot,
 * the embedded bundle's manifest and id, and the device hosts outside production.
 */
export function buildResourceFile({
  builtAt,
  embeddedBundleId,
  files,
  hosts,
  projectConfig,
  version,
}: ResourceFileInput): Configuration {
  return ConfigurationSchema.parse({
    ...projectConfig,
    channelId: process.env.HOTCODEPUSH_CHANNEL_ID || projectConfig.channelId,
    builtAt,
    embeddedBundleId,
    embeddedBundleManifest: {
      appId: projectConfig.appId,
      bundleId: embeddedBundleId ?? UNREGISTERED_BUNDLE_ID,
      createdAt: builtAt,
      deltas: [],
      files: files.map(({ path, sha256, sizeBytes }) => ({
        path,
        sha256,
        sizeBytes,
      })),
      pack: null,
      patches: [],
      version,
    },
    fingerprint: null,
    ...(hosts.filesBaseUrl === undefined
      ? {}
      : { filesBaseUrl: hosts.filesBaseUrl }),
    ...(hosts.updatesBaseUrl === undefined
      ? {}
      : { updatesBaseUrl: hosts.updatesBaseUrl }),
  });
}

/**
 * Where each platform's native project reads the file: the app bundle's resources on iOS, the assets on Android.
 */
export function resolveResourceFilePath(
  platform: Platform,
  nativeProjectPath: string,
): string {
  return platform === 'ios'
    ? join(nativeProjectPath, 'App', 'App', 'hotcodepush.json')
    : join(
        nativeProjectPath,
        'app',
        'src',
        'main',
        'assets',
        'hotcodepush.json',
      );
}

export function writeResourceFile(
  filePath: string,
  configuration: Configuration,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(configuration, null, 2)}\n`);
}
