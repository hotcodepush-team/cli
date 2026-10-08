import { resolve } from 'node:path';
import type { Binary, HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { PROJECT_CONFIG_FILE_NAME } from '../../config/consts.js';
import { createApiClient } from '../../utils/api-client.js';
import type { BinaryIdentity } from '../../utils/binary-identity.js';
import type { BundleFile } from '../../utils/bundle-files.js';
import { collectBundleFiles } from '../../utils/bundle-files.js';
import {
  compressFiles,
  withTemporaryDirectory,
} from '../../utils/compressed-files.js';
import { isCi, isOfflineBuild } from '../../utils/environment.js';
import {
  CliError,
  InvalidParameterError,
  MissingParameterError,
  PipelineNotLoggedInError,
} from '../../utils/errors.js';
import { readFingerprint } from '../../utils/fingerprint.js';
import {
  detectFramework,
  resolveInputDirectoryPath,
} from '../../utils/framework.js';
import type { FrameworkModule } from '../../utils/frameworks/index.js';
import { resolveFrameworkModule } from '../../utils/frameworks/index.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveDeviceHosts } from '../../utils/hosts.js';
import { printJson } from '../../utils/output.js';
import { createReporter, resolveByteText } from '../../utils/progress.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import {
  assertProjectConfigAppId,
  locateProjectConfig,
  resolveProjectChannel,
} from '../../utils/project-config.js';
import { promptSelect } from '../../utils/prompts.js';
import {
  buildResourceFile,
  writeResourceFile,
} from '../../utils/resource-file.js';
import {
  fetchChannels,
  fetchResourceId,
} from '../../utils/resource-resolution.js';
import { readToken } from '../../utils/token-store.js';
import type { Platform, UploadedFiles } from '../../utils/upload.js';
import {
  assertWithinBundleBytesLimit,
  resolveMissingSha256s,
  uploadMissingFiles,
} from '../../utils/upload.js';
import { readApiUrl } from '../../utils/user-config.js';

/**
 * What the API answered for the build: the channel's id, null when the build names none, and the binary created,
 * or the one warning that says what was skipped and why; a local build has neither, since it creates no binary.
 */
interface Registration extends UploadedFiles {
  binary: Binary | null;
  channelId: string | null;
  skippedReason: string | null;
}

/**
 * The channel the build follows as given, a name or an id, with where it came from for an error to name.
 */
interface ChannelReference {
  reference: string;
  source: string;
}

/**
 * Why a local build does not ask the API: the offline switch, or no token to ask with.
 */
type OfflineCause = 'no-token' | 'offline-switch';

/**
 * What registers the store build beside its files: the app, the platform, the version and build, and the native contract it was built on.
 */
interface RegistrationRequest extends BinaryIdentity {
  appId: string;
  fingerprint: string;
  force: boolean;
  platform: Platform;
}

const ID_SCHEMA = z.guid();

const PLATFORMS = ['android', 'ios'] as const;

const NO_UPLOAD: UploadedFiles = { uploadedBytes: 0, uploadedFileCount: 0 };

export default defineCommand({
  description:
    'The build step the native hook calls: writes the resource file the SDK reads and, under CI or with --register, creates the store build, the binary, with the bundle it ships; HOTCODEPUSH_OFFLINE=1 builds without the API, naming no channel unless it is given by id, for a build that is never shipped.',
  examples: [
    'hotcodepush binary create --platform ios',
    'hotcodepush binary create --platform android --binary-version 2.4.1 --binary-build 57 --force',
  ],
  options: defineCommandOptions({
    binaryBuild: z
      .string()
      .optional()
      .describe(
        "The store build's build number; read from the native project by default.",
      ),
    binaryVersion: z
      .string()
      .optional()
      .describe(
        "The store build's version; read from the native project by default.",
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        'Replace a registration whose fingerprint conflicts, for the deliberate pre-ship rebuild.',
      ),
    out: z
      .string()
      .optional()
      .describe(
        "Where to write the resource file; the platform's native project by default.",
      ),
    path: z
      .string()
      .optional()
      .describe(
        "The embedded assets to hash; hotcodepush.json's dir by default.",
      ),
    platform: z
      .enum(PLATFORMS)
      .optional()
      .describe(
        "The platform being built; CAPACITOR_PLATFORM_NAME's when the hook runs.",
      ),
    register: z
      .boolean()
      .optional()
      .describe(
        'Create the binary from a build outside CI, a store build made on this machine; a build under CI always creates it.',
      ),
  }),
  action: async options => {
    if (options.platform === undefined && isWebHookRun()) {
      return;
    }
    const { directoryPath, projectConfig } = locateProjectConfig(
      options.config,
    );
    const completeProjectConfig = assertProjectConfig(projectConfig);
    const platform =
      options.platform ?? (await resolvePlatformFromEnvironment(options));
    const framework = resolveFrameworkModule(detectFramework(directoryPath));
    const files = await collectEmbeddedFiles(
      framework,
      platform,
      await resolveInputDirectoryPath(
        options,
        projectConfig,
        directoryPath,
        framework,
      ),
    );
    const resourceFilePath = resolveResourceFilePath(
      options.out,
      platform,
      directoryPath,
      framework,
    );
    const fingerprint = await readFingerprint(
      directoryPath,
      completeProjectConfig.nativeSources ?? [],
    );
    const channelReference = resolveChannelReference(completeProjectConfig);
    if (files === undefined) {
      // a build that bundled nothing runs the development server's JavaScript: its resource file turns live updates off, and the API is asked nothing
      writeResourceFile(
        resourceFilePath,
        buildResourceFile({
          builtAt: new Date().toISOString(),
          channelId: resolveChannelIdByShape(channelReference),
          embeddedBundle: null,
          fingerprint,
          hosts: resolveDeviceHosts(readApiUrl()),
          platform,
          projectConfig: completeProjectConfig,
        }),
      );
      process.stderr.write(
        `No binary created: the ${platform} build bundled no JavaScript, as a debug build served by the development server does. Wrote ${resourceFilePath} without an embedded bundle: live updates are off in this build.\n`,
      );
      if (options.json) {
        printJson({ binary: null, resourceFilePath, ...NO_UPLOAD });
      }
      return;
    }
    assertWithinBundleBytesLimit(files);
    const identity = resolveBinaryIdentity(
      options,
      platform,
      directoryPath,
      framework,
    );
    const reporter = createReporter(options);
    const isRegistering = options.register === true || isCi();
    const registration = await registerBuild(
      {
        ...identity,
        appId: completeProjectConfig.appId,
        fingerprint,
        force: options.force ?? false,
        platform,
      },
      channelReference,
      files,
      reporter,
      isRegistering,
    );
    writeResourceFile(
      resourceFilePath,
      buildResourceFile({
        builtAt: new Date().toISOString(),
        channelId: registration.channelId,
        embeddedBundle: {
          bundleVersion: identity.binaryVersion,
          files,
          id: registration.binary?.bundleId ?? null,
        },
        fingerprint,
        hosts: resolveDeviceHosts(readApiUrl()),
        platform,
        projectConfig: completeProjectConfig,
      }),
    );
    if (registration.skippedReason !== null) {
      process.stderr.write(`Warning: ${registration.skippedReason}\n`);
    }
    if (options.json) {
      printJson({
        binary: registration.binary,
        resourceFilePath,
        uploadedBytes: registration.uploadedBytes,
        uploadedFileCount: registration.uploadedFileCount,
      });
      return;
    }
    console.log(`Wrote ${resourceFilePath} for ${platform}.`);
    const identityText = `${platform} ${identity.binaryVersion} (${identity.binaryBuild})`;
    if (registration.binary !== null) {
      console.log(
        `Registered the binary ${identityText}: ${registration.uploadedFileCount} files uploaded, ${resolveByteText(registration.uploadedBytes)}.`,
      );
    } else if (!isRegistering) {
      console.log(
        `No binary created for ${identityText}: only a build under CI or with --register creates one, leaving the identity to the store build CI makes.`,
      );
    }
  },
});

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
 * Registers the build with the API: the channel's name resolved to its id, then, when the build registers, the binary
 * created on its identity, the files the API names as missing uploaded first. A local build registers only with --register,
 * so a developer's build never claims the identity CI's store build of the same version and build needs.
 * A local build never breaks: offline, without a token, or with an API that cannot be reached or refuses, it goes on with
 * one warning, without a binary and with the channel only when given by id.
 * A pipeline fails instead, since what it ships must name its channel; a channel name the app lacks fails everywhere.
 */
async function registerBuild(
  request: RegistrationRequest,
  channelReference: ChannelReference,
  files: BundleFile[],
  reporter: ReturnType<typeof createReporter>,
  isRegistering: boolean,
): Promise<Registration> {
  const channelIdByShape = resolveChannelIdByShape(channelReference);
  const offlineCause = resolveOfflineCause();
  if (offlineCause !== undefined) {
    return {
      ...NO_UPLOAD,
      binary: null,
      channelId: channelIdByShape,
      skippedReason: resolveOfflineText(offlineCause, channelIdByShape),
    };
  }
  const hotCodePush = createApiClient();
  let channelId: string;
  try {
    channelId =
      channelIdByShape ??
      (await fetchResourceId(
        'channel',
        channelReference.reference,
        () => fetchChannels(hotCodePush, request.appId),
        channelReference.source,
      ));
  } catch (error) {
    if (error instanceof CliError || isCi()) {
      throw error;
    }
    return {
      ...NO_UPLOAD,
      binary: null,
      channelId: null,
      skippedReason: `the channel could not be resolved, so the build names none and takes no updates, and no binary was created: ${resolveFailureText(error)}`,
    };
  }
  if (!isRegistering) {
    return { ...NO_UPLOAD, binary: null, channelId, skippedReason: null };
  }
  try {
    return {
      ...(await registerWithUploads(hotCodePush, request, files, reporter)),
      channelId,
      skippedReason: null,
    };
  } catch (error) {
    // a build never breaks locally: a refused, conflicting or unreachable creation is one warning; CI fails with it
    if (isCi()) {
      throw error;
    }
    return {
      ...NO_UPLOAD,
      binary: null,
      channelId,
      skippedReason: `the binary was not created: ${resolveFailureText(error)}`,
    };
  }
}

async function registerWithUploads(
  hotCodePush: HotCodePush,
  request: RegistrationRequest,
  files: BundleFile[],
  reporter: ReturnType<typeof createReporter>,
): Promise<UploadedFiles & { binary: Binary }> {
  const { binaryBuild, binaryVersion, ...identityless } = request;
  const createOptions = {
    ...identityless,
    build: binaryBuild,
    files: files.map(({ path, sha256, sizeBytes }) => ({
      path,
      sha256,
      sizeBytes,
    })),
    version: binaryVersion,
  };
  try {
    const binary = await hotCodePush.apps.binaries.create(createOptions);
    return { ...NO_UPLOAD, binary };
  } catch (error) {
    const missingSha256s = resolveMissingSha256s(error);
    if (missingSha256s === undefined) {
      throw error;
    }
    reporter.report(`Uploading ${missingSha256s.length} files the app lacks…`);
    const uploadedFiles = await withTemporaryDirectory(
      async temporaryDirectoryPath =>
        uploadMissingFiles(
          hotCodePush,
          request.appId,
          missingSha256s,
          await compressFiles(
            files.filter(({ sha256 }) => missingSha256s.includes(sha256)),
            temporaryDirectoryPath,
          ),
          reporter,
        ),
    );
    const binary = await hotCodePush.apps.binaries.create(createOptions);
    return { ...uploadedFiles, binary };
  }
}

/**
 * The embedded bundle's files under `--path`: every file there, or the part of a native build's output the framework names.
 */
function collectEmbeddedFiles(
  framework: FrameworkModule,
  platform: Platform,
  inputDirectoryPath: string,
): Promise<BundleFile[] | undefined> {
  return framework.collectEmbeddedFiles === undefined
    ? collectBundleFiles(inputDirectoryPath)
    : framework.collectEmbeddedFiles(platform, inputDirectoryPath);
}

function resolveBinaryIdentity(
  options: { binaryBuild?: string; binaryVersion?: string },
  platform: Platform,
  projectDirectoryPath: string,
  framework: FrameworkModule,
): BinaryIdentity {
  if (
    options.binaryBuild !== undefined &&
    options.binaryVersion !== undefined
  ) {
    return {
      binaryBuild: options.binaryBuild,
      binaryVersion: options.binaryVersion,
    };
  }
  const readIdentity = framework.readBinaryIdentity(
    platform,
    projectDirectoryPath,
  );
  return {
    binaryBuild: options.binaryBuild ?? readIdentity.binaryBuild,
    binaryVersion: options.binaryVersion ?? readIdentity.binaryVersion,
  };
}

/**
 * `--out` as the native build names it, otherwise the place the framework's native project reads the file from.
 */
function resolveResourceFilePath(
  out: string | undefined,
  platform: Platform,
  projectDirectoryPath: string,
  framework: FrameworkModule,
): string {
  const resourceFilePath =
    out === undefined
      ? framework.resolveResourceFilePath(
          platform,
          framework.resolveNativeProjectPaths(projectDirectoryPath)[platform],
        )
      : resolve(out);
  if (resourceFilePath === undefined) {
    throw new MissingParameterError('--out');
  }
  return resourceFilePath;
}

/**
 * Capacitor runs the copy hook for `web` too, where no native project takes a resource file: nothing to do, and no failure,
 * whatever the configuration says, since a web-only checkout may have none.
 */
function isWebHookRun(): boolean {
  const platformName = process.env.CAPACITOR_PLATFORM_NAME;
  return (
    platformName !== undefined &&
    platformName !== '' &&
    !PLATFORMS.includes(platformName as Platform)
  );
}

/**
 * The platform Capacitor's hook names in `CAPACITOR_PLATFORM_NAME`, otherwise a pick when interactive.
 */
function resolvePlatformFromEnvironment(options: {
  json?: boolean;
  yes?: boolean;
}): Promise<Platform> {
  const platformName = process.env.CAPACITOR_PLATFORM_NAME;
  if (platformName === 'android' || platformName === 'ios') {
    return Promise.resolve(platformName);
  }
  return promptSelect(
    '--platform',
    'Which platform?',
    PLATFORMS.map(platform => ({ label: platform, value: platform })),
    options,
  );
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

/**
 * The channel's id when the build names it by id, which needs no API; null for a name, which only the API resolves.
 */
function resolveChannelIdByShape(
  channelReference: ChannelReference,
): string | null {
  return ID_SCHEMA.safeParse(channelReference.reference).success
    ? channelReference.reference
    : null;
}

/**
 * Whether the build goes on without the API: under `HOTCODEPUSH_OFFLINE`, or without a token on a local machine;
 * a pipeline without a token fails, since what it ships must name its channel.
 */
function resolveOfflineCause(): OfflineCause | undefined {
  if (isOfflineBuild()) {
    return 'offline-switch';
  }
  if (readToken() !== undefined) {
    return undefined;
  }
  if (isCi()) {
    throw new PipelineNotLoggedInError();
  }
  return 'no-token';
}

/**
 * The one warning of a build made offline: why, what it lacks, and for a missing token how to get one.
 */
function resolveOfflineText(
  offlineCause: OfflineCause,
  channelId: string | null,
): string {
  const causeText =
    offlineCause === 'offline-switch'
      ? 'HOTCODEPUSH_OFFLINE is set'
      : 'not logged in';
  const consequenceText =
    channelId === null
      ? ': it names no channel and takes no updates until it is built with a token, and no binary was created'
      : ' and no binary was created';
  const fixText =
    offlineCause === 'offline-switch'
      ? ''
      : '; run "hotcodepush login" or set HOTCODEPUSH_TOKEN';
  return `${causeText}, so the build was made offline${consequenceText}${fixText}.`;
}

function resolveFailureText(error: unknown): string {
  if (error instanceof HotCodePushError) {
    return `${error.code} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
