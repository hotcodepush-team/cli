import { resolve } from 'node:path';
import type { HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import type { BundleFile } from './bundle-files.js';
import { collectBundleFiles } from './bundle-files.js';
import type { InteractivityOptions } from './environment.js';
import { isOfflineBuild } from './environment.js';
import { InvalidParameterError } from './errors.js';
import { readFingerprint } from './fingerprint.js';
import {
  assertMissingParameter,
  detectFramework,
  resolveInputDirectoryPath,
} from './framework.js';
import { resolveFrameworkModule } from './frameworks/index.js';
import { resolveDeviceHosts } from './hosts.js';
import type { ProjectConfig } from './project-config.js';
import {
  assertProjectConfigAppId,
  locateProjectConfig,
  resolveProjectChannel,
} from './project-config.js';
import { promptSelect } from './prompts.js';
import type { EmbeddedBundle } from './resource-file.js';
import { buildResourceFile, writeResourceFile } from './resource-file.js';
import { fetchChannels, fetchResourceId } from './resource-resolution.js';
import { readToken } from './token-store.js';
import type { Platform } from './upload.js';
import { readApiUrl } from './user-config.js';

/**
 * What a build step knows before it asks the API anything: the project's configuration, the platform, the embedded
 * bundle's files, none for a build that bundled nothing, the fingerprint, the channel as given and where the resource file goes.
 */
export interface BuildStep {
  channelReference: ChannelReference;
  embeddedFiles: BundleFile[] | undefined;
  fingerprint: string;
  platform: Platform;
  projectConfig: ProjectConfig & { appId: string };
  resourceFilePath: string;
}

/**
 * The flags of a build step, the command the native build runs.
 */
export interface BuildStepOptions extends InteractivityOptions {
  config?: string;
  embeddedBundlePath?: string;
  platform?: Platform;
  resourceFilePath?: string;
}

/**
 * The channel the build follows as given, a name or an id, with where it came from for an error to name.
 */
export interface ChannelReference {
  reference: string;
  source: string;
}

/**
 * Why a build does not ask the API: the offline switch, or no token to ask with.
 */
export type OfflineCause = 'no-token' | 'offline-switch';

const ID_SCHEMA = z.guid();

const PLATFORMS = ['android', 'ios'] as const;

/**
 * The flags both build steps take: the platform, the embedded bundle's directory and the resource file's place in the app.
 */
export const buildStepShape = {
  embeddedBundlePath: z
    .string()
    .optional()
    .describe(
      "The directory of the embedded bundle, the files the build puts into the app; the framework's build output by default.",
    ),
  platform: z.enum(PLATFORMS).optional().describe('The platform being built.'),
  resourceFilePath: z
    .string()
    .optional()
    .describe('Where the resource file goes, in the app the build makes.'),
};

/**
 * The project, the platform, the embedded bundle's files and the fingerprint, read in the order a failure should name them.
 */
export async function readBuildStep(
  options: BuildStepOptions,
): Promise<BuildStep> {
  const { directoryPath, projectConfig } = locateProjectConfig(options.config);
  const completeProjectConfig = assertProjectConfig(projectConfig);
  const platform =
    options.platform ??
    (await promptSelect(
      '--platform',
      'Which platform?',
      PLATFORMS.map(platform => ({ label: platform, value: platform })),
      options,
    ));
  const framework = resolveFrameworkModule(detectFramework(directoryPath));
  const embeddedBundlePath = await resolveInputDirectoryPath(
    { ...options, path: options.embeddedBundlePath },
    '--embedded-bundle-path',
    directoryPath,
    framework,
  );
  const embeddedFiles =
    framework.collectEmbeddedFiles === undefined
      ? await collectBundleFiles(embeddedBundlePath)
      : await framework.collectEmbeddedFiles(platform, embeddedBundlePath);
  const resourceFilePath = resolve(
    assertMissingParameter(options.resourceFilePath, '--resource-file-path'),
  );
  return {
    channelReference: resolveChannelReference(completeProjectConfig),
    embeddedFiles,
    fingerprint: await readFingerprint(
      directoryPath,
      completeProjectConfig.extraFingerprintPaths ?? [],
    ),
    platform,
    projectConfig: completeProjectConfig,
    resourceFilePath,
  };
}

/**
 * The channel's id when the build names it by id, which needs no API; null for a name, which only the API resolves.
 */
export function resolveChannelIdByShape(
  channelReference: ChannelReference,
): string | null {
  return ID_SCHEMA.safeParse(channelReference.reference).success
    ? channelReference.reference
    : null;
}

/**
 * The channel name resolved to its id through the API; a name the app lacks is `E_INVALID_PARAMETER` naming where it came from.
 */
export function fetchChannelId(
  hotCodePush: HotCodePush,
  { channelReference, projectConfig }: BuildStep,
): Promise<string> {
  return fetchResourceId(
    'channel',
    channelReference.reference,
    () => fetchChannels(hotCodePush, projectConfig.appId),
    channelReference.source,
  );
}

/**
 * Whether the build goes on without the API: under `HOTCODEPUSH_OFFLINE`, or without a token to ask with.
 */
export function resolveOfflineCause(): OfflineCause | undefined {
  if (isOfflineBuild()) {
    return 'offline-switch';
  }
  return readToken() === undefined ? 'no-token' : undefined;
}

export function resolveFailureText(error: unknown): string {
  if (error instanceof HotCodePushError) {
    return `${error.code} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The resource file the SDK reads, written where the build names it: the floor, the channel, the fingerprint, the embedded
 * bundle, none in a build that bundled nothing, and the device hosts.
 */
export function writeBuildResourceFile(
  { fingerprint, platform, projectConfig, resourceFilePath }: BuildStep,
  channelId: string | null,
  embeddedBundle: EmbeddedBundle | null,
): void {
  writeResourceFile(
    resourceFilePath,
    buildResourceFile({
      builtAt: new Date().toISOString(),
      channelId,
      embeddedBundle,
      fingerprint,
      hosts: resolveDeviceHosts(readApiUrl()),
      platform,
      projectConfig,
    }),
  );
}

function assertProjectConfig(
  projectConfig: ProjectConfig | undefined,
): ProjectConfig & { appId: string } {
  if (projectConfig?.appId === undefined) {
    throw new InvalidParameterError(
      'hotcodepush.json with appId is missing; run "hotcodepush init" or --config',
      undefined,
    );
  }
  assertProjectConfigAppId(projectConfig.appId);
  return { ...projectConfig, appId: projectConfig.appId };
}

/**
 * The channel the build follows: `HOTCODEPUSH_CHANNEL`, a build flavour's override, otherwise hotcodepush.json's.
 */
function resolveChannelReference(
  projectConfig: ProjectConfig,
): ChannelReference {
  const flavourChannel = process.env.HOTCODEPUSH_CHANNEL;
  return flavourChannel
    ? { reference: flavourChannel, source: 'HOTCODEPUSH_CHANNEL' }
    : {
        reference: resolveProjectChannel(projectConfig),
        source: PROJECT_CONFIG_FILE_NAME,
      };
}
