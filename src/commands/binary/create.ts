import type { Binary, HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { BuildStep, OfflineCause } from '../../utils/build-step.js';
import {
  buildStepShape,
  fetchChannelId,
  readBuildStep,
  resolveChannelIdByShape,
  resolveFailureText,
  resolveOfflineCause,
  writeBuildResourceFile,
} from '../../utils/build-step.js';
import type { BundleFile } from '../../utils/bundle-files.js';
import {
  compressFiles,
  withTemporaryDirectory,
} from '../../utils/compressed-files.js';
import { isCi } from '../../utils/environment.js';
import { CliError, PipelineNotLoggedInError } from '../../utils/errors.js';
import { assertMissingParameter } from '../../utils/framework.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { createReporter, resolveByteText } from '../../utils/progress.js';
import type { Platform, UploadedFiles } from '../../utils/upload.js';
import {
  assertWithinBundleBytesLimit,
  resolveMissingSha256s,
  uploadMissingFiles,
} from '../../utils/upload.js';

/**
 * The store build's version and build number as the build's own variables give them: `CFBundleShortVersionString` and
 * `CFBundleVersion` on iOS, `versionName` and `versionCode` on Android, the identity the binary is created under.
 */
interface BinaryIdentity {
  binaryBuild: string;
  binaryVersion: string;
}

/**
 * What the API answered for the build: the channel's id, null when the build names none, and the binary created,
 * or the one warning that says what was skipped and why.
 */
interface BinaryCreation extends UploadedFiles {
  binary: Binary | null;
  channelId: string | null;
  skippedReason: string | null;
}

/**
 * What creates the store build beside its files: the app, the platform, the version and build, and the native contract it was built on.
 */
interface BinaryCreationRequest extends BinaryIdentity {
  appId: string;
  fingerprint: string;
  force: boolean;
  platform: Platform;
}

const NO_UPLOAD: UploadedFiles = { uploadedBytes: 0, uploadedFileCount: 0 };

export default defineCommand({
  description:
    'The build step of a store build: creates the binary with the embedded bundle it ships and writes the resource file the SDK reads, naming that bundle; every other build runs resource-file write. HOTCODEPUSH_OFFLINE=1 builds without the API, naming no channel unless it is given by id and creating no binary.',
  examples: [
    'hotcodepush binary create --platform ios --embedded-bundle-path build/App.app/public --resource-file-path build/App.app/hotcodepush.json --binary-version 2.4.1 --binary-build 57',
    'hotcodepush binary create --platform android --embedded-bundle-path build/assets/public --resource-file-path build/assets/hotcodepush.json --binary-version 2.4.1 --binary-build 57 --force',
  ],
  options: defineCommandOptions({
    ...buildStepShape,
    binaryBuild: z
      .string()
      .optional()
      .describe("The store build's build number, from the build's variables."),
    binaryVersion: z
      .string()
      .optional()
      .describe("The store build's version, from the build's variables."),
    force: z
      .boolean()
      .optional()
      .describe(
        'Replace a binary whose fingerprint conflicts, for the deliberate pre-ship rebuild.',
      ),
  }),
  action: async options => {
    const buildStep = await readBuildStep(options);
    const { embeddedFiles, platform, resourceFilePath } = buildStep;
    if (embeddedFiles === undefined) {
      // a build that bundled nothing runs the development server's JavaScript: its resource file turns live updates off, and the API is asked nothing
      writeBuildResourceFile(
        buildStep,
        resolveChannelIdByShape(buildStep.channelReference),
        null,
      );
      process.stderr.write(
        `No binary created: the ${platform} build bundled no JavaScript, as a debug build served by the development server does. Wrote ${resourceFilePath} without an embedded bundle: live updates are off in this build.\n`,
      );
      if (options.json) {
        printJson({ binary: null, resourceFilePath, ...NO_UPLOAD });
      }
      return;
    }
    assertWithinBundleBytesLimit(embeddedFiles);
    const identity = resolveBinaryIdentity(options);
    const binaryCreation = await createBuildBinary(
      {
        ...identity,
        appId: buildStep.projectConfig.appId,
        fingerprint: buildStep.fingerprint,
        force: options.force ?? false,
        platform,
      },
      buildStep,
      embeddedFiles,
      createReporter(options),
    );
    writeBuildResourceFile(buildStep, binaryCreation.channelId, {
      bundleVersion: identity.binaryVersion,
      files: embeddedFiles,
      id: binaryCreation.binary?.bundleId ?? null,
    });
    if (binaryCreation.skippedReason !== null) {
      process.stderr.write(`Warning: ${binaryCreation.skippedReason}\n`);
    }
    if (options.json) {
      printJson({
        binary: binaryCreation.binary,
        resourceFilePath,
        uploadedBytes: binaryCreation.uploadedBytes,
        uploadedFileCount: binaryCreation.uploadedFileCount,
      });
      return;
    }
    console.log(`Wrote ${resourceFilePath} for ${platform}.`);
    if (binaryCreation.binary !== null) {
      console.log(
        `Created the binary ${platform} ${identity.binaryVersion} (${identity.binaryBuild}): ${binaryCreation.uploadedFileCount} files uploaded, ${resolveByteText(binaryCreation.uploadedBytes)}.`,
      );
    }
  },
});

/**
 * Creates the binary with the API: the channel's name resolved to its id, then the binary created on its identity,
 * the files the API names as missing uploaded first. A local build never breaks: offline, without a token, or with an API
 * that cannot be reached or refuses, it goes on with one warning, without a binary and with the channel only when given by id.
 * A pipeline fails instead, since what it ships must name its channel; a channel name the app lacks fails everywhere.
 */
async function createBuildBinary(
  request: BinaryCreationRequest,
  buildStep: BuildStep,
  files: BundleFile[],
  reporter: ReturnType<typeof createReporter>,
): Promise<BinaryCreation> {
  const channelIdByShape = resolveChannelIdByShape(buildStep.channelReference);
  const offlineCause = resolveOfflineCause();
  if (offlineCause === 'no-token' && isCi()) {
    throw new PipelineNotLoggedInError();
  }
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
      channelIdByShape ?? (await fetchChannelId(hotCodePush, buildStep));
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
  try {
    return {
      ...(await createBinaryWithUploads(hotCodePush, request, files, reporter)),
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

async function createBinaryWithUploads(
  hotCodePush: HotCodePush,
  request: BinaryCreationRequest,
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
 * The identity the native build passes in from its own variables; the CLI reads no project file for it.
 */
function resolveBinaryIdentity(options: {
  binaryBuild?: string;
  binaryVersion?: string;
}): BinaryIdentity {
  const binaryVersion = assertMissingParameter(
    options.binaryVersion,
    '--binary-version',
  );
  return {
    binaryBuild: assertMissingParameter(options.binaryBuild, '--binary-build'),
    binaryVersion,
  };
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
