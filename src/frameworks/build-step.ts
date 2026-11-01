import { resolve } from 'node:path';
import type { HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { fetchChannels } from '../resources/channels/fetch.js';
import {
  buildResourceFile,
  writeResourceFile,
} from '../resources/resource-files.js';
import type { EmbeddedBundle } from '../resources/resource-files.js';
import type { BundleFile } from '../upload/bundle-files.js';
import { collectBundleFiles } from '../upload/bundle-files.js';
import { readFingerprint } from '../upload/fingerprint.js';
import type { Platform } from '../upload/upload.js';
import { PLATFORMS } from '../upload/upload.js';
import type { InteractivityOptions } from '../utils/environment.js';
import { isOfflineBuild } from '../utils/environment.js';
import { InvalidParameterError } from '../utils/errors.js';
import { resolveDeviceHosts } from '../utils/hosts.js';
import type { ProjectConfig } from '../utils/project-config.js';
import {
  assertProjectConfigAppId,
  locateProjectConfig,
  resolveProjectChannel,
} from '../utils/project-config.js';
import { promptSelect } from '../utils/prompts.js';
import { isId } from '../utils/reference.js';
import { fetchResourceId } from '../utils/resources.js';
import { readToken } from '../utils/token-store.js';
import { readApiUrl } from '../utils/user-config.js';
import {
  assertMissingParameter,
  detectFramework,
  readInputDirectoryPath,
} from './framework.js';
import { omitNativeGlue } from './native-glue.js';
import { resolveFrameworkModule } from './index.js';

export interface BuildStep {
  channelReference: ChannelReference;
  embeddedFiles: BundleFile[] | undefined;
  fingerprint: string;
  platform: Platform;
  projectConfig: ProjectConfig & { appId: string };
  resourceFilePath: string;
}

export interface BuildStepOptions extends InteractivityOptions {
  config?: string;
  embeddedBundlePath?: string;
  platform?: Platform;
  resourceFilePath?: string;
}

export interface ChannelReference {
  reference: string;
  source: string;
}

export type OfflineCause = 'no-token' | 'offline-switch';

export const buildStepShape = {
  embeddedBundlePath: z
    .string()
    .optional()
    .describe(
      "The directory of the embedded bundle, the files the build puts into the app. Defaults to the framework's build output.",
    ),
  platform: z
    .enum(PLATFORMS)
    .optional()
    .describe('The platform being built, ios or android.'),
  resourceFilePath: z
    .string()
    .optional()
    .describe('Where the resource file goes, in the app the build makes.'),
};

// Read in the order a failure should name them.
// The embedded bundle leaves out the native glue, so its manifest matches a release of the same web build.
export async function readBuildStep(
  options: BuildStepOptions,
): Promise<BuildStep> {
  const { directoryPath, projectConfig } = locateProjectConfig(options.config);
  const completeProjectConfig = assertProjectConfig(projectConfig);
  const platform =
    options.platform ??
    (await promptSelect(options, {
      choices: PLATFORMS.map(platform => ({
        label: platform,
        value: platform,
      })),
      flag: '--platform',
      message: 'Which platform?',
    }));
  const framework = resolveFrameworkModule(detectFramework(directoryPath));
  const embeddedBundlePath = await readInputDirectoryPath(
    { ...options, path: options.embeddedBundlePath },
    {
      framework,
      pathFlag: '--embedded-bundle-path',
      projectDirectoryPath: directoryPath,
    },
  );
  const embeddedFiles =
    framework.collectEmbeddedFiles === undefined
      ? omitNativeGlue(
          await collectBundleFiles(embeddedBundlePath),
          framework.nativeGluePaths ?? [],
        )
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

// An id needs no API, but only the API can resolve a name.
export function resolveChannelIdByShape(
  channelReference: ChannelReference,
): string | null {
  return isId(channelReference.reference) ? channelReference.reference : null;
}

export function fetchBuildStepChannelId(
  hotCodePush: HotCodePush,
  { channelReference, projectConfig }: BuildStep,
): Promise<string> {
  return fetchResourceId({
    fetchResources: () => fetchChannels(hotCodePush, projectConfig.appId),
    noun: 'channel',
    reference: channelReference.reference,
    source: channelReference.source,
  });
}

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
      'The project has no hotcodepush.json with an appId.',
      { fix: 'Run "hotcodepush init", or pass the file with --config.' },
    );
  }
  assertProjectConfigAppId(projectConfig.appId);
  return { ...projectConfig, appId: projectConfig.appId };
}

// A build flavour sets `HOTCODEPUSH_CHANNEL` to override the channel of hotcodepush.json.
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
