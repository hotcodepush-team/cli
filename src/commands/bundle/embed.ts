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
import {
  InvalidParameterError,
  MissingParameterError,
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

interface Registration extends UploadedFiles {
  binary: Binary | null;
  skippedReason: string | null;
}

/**
 * What registers the store build beside its files: the app, the platform, the version and build, and the native contract it was built on.
 */
interface RegistrationRequest extends BinaryIdentity {
  appId: string;
  fingerprint: string;
  force: boolean;
  platform: Platform;
}

const PLATFORMS = ['android', 'ios'] as const;

const NO_UPLOAD: UploadedFiles = { uploadedBytes: 0, uploadedFileCount: 0 };

export default defineCommand({
  description:
    'The build step the native hook calls: writes the resource file the SDK reads and registers the store build, the binary, with the bundle it ships.',
  examples: [
    'hotcodepush bundle embed --platform ios',
    'hotcodepush bundle embed --platform android --binary-version 2.4.1 --binary-build 57 --force',
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
    if (files === undefined) {
      // a build that bundled nothing runs the development server's JavaScript: no API call, no resource file, no failure
      process.stderr.write(
        `Nothing is embedded: the ${platform} build bundled no JavaScript, as a debug build served by the development server does.\n`,
      );
      return;
    }
    assertWithinBundleBytesLimit(files);
    const resourceFilePath = resolveResourceFilePath(
      options.out,
      platform,
      directoryPath,
      framework,
    );
    const channelId = await fetchBuildChannelId(completeProjectConfig);
    const identity = resolveBinaryIdentity(
      options,
      platform,
      directoryPath,
      framework,
    );
    const fingerprint = await readFingerprint(
      directoryPath,
      completeProjectConfig.nativeSources ?? [],
    );
    const reporter = createReporter(options);
    const registration = await registerBinary(
      {
        ...identity,
        appId: completeProjectConfig.appId,
        fingerprint,
        force: options.force ?? false,
        platform,
      },
      files,
      reporter,
    );
    const builtAt = new Date().toISOString();
    writeResourceFile(
      resourceFilePath,
      buildResourceFile({
        builtAt,
        bundleVersion: identity.binaryVersion,
        channelId,
        embeddedBundleId: registration.binary?.bundleId ?? null,
        files,
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
    if (registration.binary !== null) {
      console.log(
        `Registered the binary ${platform} ${identity.binaryVersion} (${identity.binaryBuild}): ${registration.uploadedFileCount} files uploaded, ${resolveByteText(registration.uploadedBytes)}.`,
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
 * The id of the channel the build follows: `HOTCODEPUSH_CHANNEL`, a build flavour's override, otherwise hotcodepush.json's.
 * A name is resolved through the API, so a name the app does not have fails the build with the source named; an id is taken as it is.
 */
function fetchBuildChannelId(
  projectConfig: ProjectConfig & { appId: string },
): Promise<string> {
  const flavourChannel = process.env.HOTCODEPUSH_CHANNEL;
  const [reference, source] = flavourChannel
    ? [flavourChannel, 'HOTCODEPUSH_CHANNEL']
    : [resolveProjectChannel(projectConfig), PROJECT_CONFIG_FILE_NAME];
  return fetchResourceId(
    'channel',
    reference,
    () => fetchChannels(createApiClient(), projectConfig.appId),
    source,
  );
}

/**
 * Registers the bundle create-only on its binary identity, uploading the files the API names as missing first.
 * Without a token the registration is skipped; a failure skips it too with one warning, except in CI, where a conflicting
 * fingerprint under an unbumped build number is a pipeline mistake someone must see — a build never breaks locally.
 */
async function registerBinary(
  request: RegistrationRequest,
  files: BundleFile[],
  reporter: ReturnType<typeof createReporter>,
): Promise<Registration> {
  if (readToken() === undefined) {
    return {
      ...NO_UPLOAD,
      binary: null,
      skippedReason:
        'not logged in, so the binary was not registered; run "hotcodepush login" or set HOTCODEPUSH_TOKEN.',
    };
  }
  const hotCodePush = createApiClient();
  try {
    return await registerWithUploads(hotCodePush, request, files, reporter);
  } catch (error) {
    // a build never breaks locally: a refused, conflicting or unreachable registration is one warning; CI fails with it
    if (process.env.CI) {
      throw error;
    }
    return {
      ...NO_UPLOAD,
      binary: null,
      skippedReason: `the binary was not registered: ${resolveFailureText(error)}`,
    };
  }
}

async function registerWithUploads(
  hotCodePush: HotCodePush,
  request: RegistrationRequest,
  files: BundleFile[],
  reporter: ReturnType<typeof createReporter>,
): Promise<Registration> {
  const createOptions = {
    ...request,
    files: files.map(({ path, sha256, sizeBytes }) => ({
      path,
      sha256,
      sizeBytes,
    })),
  };
  try {
    const binary = await hotCodePush.apps.binaries.create(createOptions);
    return { ...NO_UPLOAD, binary, skippedReason: null };
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
    return { ...uploadedFiles, binary, skippedReason: null };
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

function resolveFailureText(error: unknown): string {
  if (error instanceof HotCodePushError) {
    return `${error.code} ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
