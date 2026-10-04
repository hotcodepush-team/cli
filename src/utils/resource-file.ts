import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Configuration } from '@hotcodepush/protocol';
import { ConfigurationSchema } from '@hotcodepush/protocol';
import type { BundleFile } from './bundle-files.js';
import type { DeviceHosts } from './hosts.js';
import type { ProjectConfig } from './project-config.js';
import type { Platform } from './upload.js';

interface ResourceFileInput {
  builtAt: string;
  bundleVersion: string;
  channelId: string;
  embeddedBundleId: string | null;
  files: BundleFile[];
  fingerprint: string;
  hosts: DeviceHosts;
  platform: Platform;
  projectConfig: ProjectConfig;
}

/**
 * The resource file: the project's configuration with the channel as the id binary create resolved, plus what only
 * a build step can know — the floor, the fingerprint, the embedded bundle's manifest and id, and the device hosts outside production.
 * The manifest is the bundle manifest without patches, unsigned, the same whether the bundle was registered or not.
 */
export function buildResourceFile({
  builtAt,
  bundleVersion,
  channelId,
  embeddedBundleId,
  files,
  fingerprint,
  hosts,
  platform,
  projectConfig,
}: ResourceFileInput): Configuration {
  return ConfigurationSchema.parse({
    ...omitChannel(projectConfig),
    builtAt,
    channelId,
    embeddedBundleId,
    embeddedBundleManifest: {
      appId: projectConfig.appId,
      bundleVersion,
      files: files.map(({ path, sha256, sizeBytes }) => ({
        path,
        sha256,
        sizeBytes,
      })),
      fingerprint,
      keyId: null,
      platforms: [platform],
    },
    fingerprint,
    ...(hosts.filesBaseUrl === undefined
      ? {}
      : { filesBaseUrl: hosts.filesBaseUrl }),
    ...(hosts.updatesBaseUrl === undefined
      ? {}
      : { updatesBaseUrl: hosts.updatesBaseUrl }),
  });
}

export function writeResourceFile(
  filePath: string,
  configuration: Configuration,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(configuration, null, 2)}\n`);
}

/**
 * The project's configuration without its channel, which the resolved id replaces.
 */
function omitChannel(projectConfig: ProjectConfig): ProjectConfig {
  const configuration = { ...projectConfig };
  delete configuration.channel;
  return configuration;
}
