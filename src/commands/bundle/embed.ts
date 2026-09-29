import { resolve } from 'node:path';
import type { EmbeddedBundle, HotCodePush } from '@hotcodepush/node';
import { HotCodePushError } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { BinaryIdentity } from '../../utils/binary-identity.js';
import { readBinaryIdentity } from '../../utils/binary-identity.js';
import type { BundleFile } from '../../utils/bundle-files.js';
import { collectBundleFiles } from '../../utils/bundle-files.js';
import {
  compressFiles,
  withTemporaryDirectory,
} from '../../utils/compressed-files.js';
import { InvalidParameterError } from '../../utils/errors.js';
import {
  resolveInputDirectoryPath,
  resolveNativeProjectPaths,
} from '../../utils/framework.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveDeviceHosts } from '../../utils/hosts.js';
import { printJson } from '../../utils/output.js';
import { createReporter, resolveByteText } from '../../utils/progress.js';
import type { ProjectConfig } from '../../utils/project-config.js';
import { locateProjectConfig } from '../../utils/project-config.js';
import { promptSelect } from '../../utils/prompts.js';
import {
  buildResourceFile,
  resolveResourceFilePath,
  writeResourceFile,
} from '../../utils/resource-file.js';
import { readToken } from '../../utils/token-store.js';
import type { Platform, UploadedFiles } from '../../utils/upload.js';
import {
  assertWithinBundleBytesLimit,
  resolveMissingSha256s,
  uploadMissingFiles,
} from '../../utils/upload.js';
import { readApiUrl } from '../../utils/user-config.js';

interface Registration extends UploadedFiles {
  embeddedBundle: EmbeddedBundle | null;
  skippedReason: string | null;
}

const PLATFORMS = ['android', 'ios'] as const;

const NO_UPLOAD: UploadedFiles = { uploadedBytes: 0, uploadedFileCount: 0 };

export default defineCommand({
  action: async options => {
    const { directoryPath, projectConfig } = locateProjectConfig(
      options.config,
    );
    const completeProjectConfig = assertProjectConfig(projectConfig);
    if (options.platform === undefined && isWebHookRun()) {
      return;
    }
    const platform =
      options.platform ?? (await resolvePlatformFromEnvironment(options));
    const nativeProjectPath =
      resolveNativeProjectPaths(directoryPath)[platform];
    const identity = resolveBinaryIdentity(
      options,
      platform,
      nativeProjectPath,
    );
    const files = await collectBundleFiles(
      await resolveInputDirectoryPath(options, projectConfig, directoryPath),
    );
    assertWithinBundleBytesLimit(files);
    const reporter = createReporter(options);
    const registration = await registerEmbeddedBundle(
      completeProjectConfig.appId,
      platform,
      identity,
      files,
      options.force ?? false,
      reporter,
    );
    const builtAt = new Date().toISOString();
    const resourceFilePath =
      options.out === undefined
        ? resolveResourceFilePath(platform, nativeProjectPath)
        : resolve(options.out);
    writeResourceFile(
      resourceFilePath,
      buildResourceFile({
        builtAt,
        embeddedBundleId: registration.embeddedBundle?.bundleId ?? null,
        files,
        hosts: resolveDeviceHosts(readApiUrl()),
        projectConfig: completeProjectConfig,
        version: identity.binaryVersion,
      }),
    );
    if (registration.skippedReason !== null) {
      process.stderr.write(`Warning: ${registration.skippedReason}\n`);
    }
    if (options.json) {
      printJson({
        embeddedBundle: registration.embeddedBundle,
        resourceFilePath,
        uploadedBytes: registration.uploadedBytes,
        uploadedFileCount: registration.uploadedFileCount,
      });
      return;
    }
    console.log(`Wrote ${resourceFilePath} for ${platform}.`);
    if (registration.embeddedBundle !== null) {
      console.log(
        `Registered the embedded bundle of ${platform} ${identity.binaryVersion} (${identity.binaryBuild}): ${registration.uploadedFileCount} files uploaded, ${resolveByteText(registration.uploadedBytes)}.`,
      );
    }
  },
  description:
    "The build step the native hook calls: writes the resource file the SDK reads and registers the store build's embedded bundle.",
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
});

function assertProjectConfig(
  projectConfig: ProjectConfig | undefined,
): ProjectConfig & { appId: string; channelId: string } {
  if (
    projectConfig?.appId === undefined ||
    projectConfig.channelId === undefined
  ) {
    throw new InvalidParameterError(
      'hotcodepush.json with appId and channelId is missing; run "hotcodepush init" or --config',
      undefined,
    );
  }
  return {
    ...projectConfig,
    appId: projectConfig.appId,
    channelId: projectConfig.channelId,
  };
}

/**
 * Registers the bundle create-only on its binary identity, uploading the files the API names as missing first.
 * Without a token the registration is skipped; a failure skips it too with one warning, except in CI, where a conflicting
 * fingerprint under an unbumped build number is a pipeline mistake someone must see — a build never breaks locally.
 */
async function registerEmbeddedBundle(
  appId: string,
  platform: Platform,
  identity: BinaryIdentity,
  files: BundleFile[],
  force: boolean,
  reporter: ReturnType<typeof createReporter>,
): Promise<Registration> {
  if (readToken() === undefined) {
    return {
      ...NO_UPLOAD,
      embeddedBundle: null,
      skippedReason:
        'not logged in, so the embedded bundle was not registered; run "hotcodepush login" or set HOTCODEPUSH_TOKEN.',
    };
  }
  const hotCodePush = createApiClient();
  try {
    return await registerWithUploads(
      hotCodePush,
      appId,
      platform,
      identity,
      files,
      force,
      reporter,
    );
  } catch (error) {
    // a build never breaks locally: a refused, conflicting or unreachable registration is one warning; CI fails with it
    if (process.env.CI) {
      throw error;
    }
    return {
      ...NO_UPLOAD,
      embeddedBundle: null,
      skippedReason: `the embedded bundle was not registered: ${resolveFailureText(error)}`,
    };
  }
}

async function registerWithUploads(
  hotCodePush: HotCodePush,
  appId: string,
  platform: Platform,
  identity: BinaryIdentity,
  files: BundleFile[],
  force: boolean,
  reporter: ReturnType<typeof createReporter>,
): Promise<Registration> {
  const createOptions = {
    appId,
    binaryBuild: identity.binaryBuild,
    binaryVersion: identity.binaryVersion,
    files: files.map(({ path, sha256, sizeBytes }) => ({
      path,
      sha256,
      sizeBytes,
    })),
    fingerprint: null,
    force,
    platform,
  };
  try {
    const embeddedBundle =
      await hotCodePush.apps.embeddedBundles.create(createOptions);
    return { ...NO_UPLOAD, embeddedBundle, skippedReason: null };
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
          appId,
          missingSha256s,
          await compressFiles(
            files.filter(({ sha256 }) => missingSha256s.includes(sha256)),
            temporaryDirectoryPath,
          ),
          reporter,
        ),
    );
    const embeddedBundle =
      await hotCodePush.apps.embeddedBundles.create(createOptions);
    return { ...uploadedFiles, embeddedBundle, skippedReason: null };
  }
}

function resolveBinaryIdentity(
  options: { binaryBuild?: string; binaryVersion?: string },
  platform: Platform,
  nativeProjectPath: string,
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
  const readIdentity = readBinaryIdentity(platform, nativeProjectPath);
  return {
    binaryBuild: options.binaryBuild ?? readIdentity.binaryBuild,
    binaryVersion: options.binaryVersion ?? readIdentity.binaryVersion,
  };
}

/**
 * Capacitor runs the copy hook for `web` too, where no native project takes a resource file: nothing to do, and no failure.
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
