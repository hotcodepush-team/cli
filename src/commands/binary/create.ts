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

// `CFBundleShortVersionString` and `CFBundleVersion` on iOS, `versionName` and `versionCode` on Android.
interface BinaryIdentity {
  binaryBuild: string;
  binaryVersion: string;
}

interface BinaryCreation {
  binary: Binary | null;
  channelId: string | null;
  pipelineFailure?: unknown;
  skippedReason: string | null;
  upload: UploadedFiles;
}

interface BinaryCreationRequest extends BinaryIdentity {
  appId: string;
  fingerprint: string;
  force: boolean;
  platform: Platform;
}

const NO_UPLOAD: UploadedFiles = { fileCount: 0, sizeBytes: 0 };

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
      writeBuildResourceFile(
        buildStep,
        resolveChannelIdByShape(buildStep.channelReference),
        null,
      );
      process.stderr.write(
        `No binary created: the ${platform} build bundled no JavaScript, as a debug build served by the development server does. Wrote ${resourceFilePath} without an embedded bundle: over-the-air (OTA) updates are off in this build.\n`,
      );
      if (options.json) {
        printJson({ binary: null, resourceFilePath, upload: NO_UPLOAD });
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
    if (binaryCreation.pipelineFailure !== undefined) {
      throw binaryCreation.pipelineFailure;
    }
    if (binaryCreation.skippedReason !== null) {
      process.stderr.write(`Warning: ${binaryCreation.skippedReason}\n`);
    }
    if (options.json) {
      printJson({
        binary: binaryCreation.binary,
        resourceFilePath,
        upload: binaryCreation.upload,
      });
      return;
    }
    console.log(`Wrote ${resourceFilePath} for ${platform}.`);
    if (binaryCreation.binary !== null) {
      console.log(
        `Created the binary ${platform} ${identity.binaryVersion} (${identity.binaryBuild}): ${binaryCreation.upload.fileCount} files uploaded, ${resolveByteText(binaryCreation.upload.sizeBytes)}.`,
      );
    }
  },
});

async function createBuildBinary(
  request: BinaryCreationRequest,
  buildStep: BuildStep,
  files: BundleFile[],
  reporter: ReturnType<typeof createReporter>,
): Promise<BinaryCreation> {
  const channelIdByShape = resolveChannelIdByShape(buildStep.channelReference);
  const offlineCause = resolveOfflineCause();
  if (offlineCause === 'no-token' && isCi()) {
    return resolveFailedCreation(
      channelIdByShape,
      new PipelineNotLoggedInError(),
    );
  }
  if (offlineCause !== undefined) {
    return {
      binary: null,
      channelId: channelIdByShape,
      skippedReason: resolveOfflineText(offlineCause, channelIdByShape),
      upload: NO_UPLOAD,
    };
  }
  const hotCodePush = createApiClient();
  let channelId: string;
  try {
    channelId =
      channelIdByShape ?? (await fetchChannelId(hotCodePush, buildStep));
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (isCi()) {
      return resolveFailedCreation(null, error);
    }
    return {
      binary: null,
      channelId: null,
      skippedReason: `the channel could not be resolved, so the build names none and takes no OTA updates, and no binary was created: ${resolveFailureText(error)}`,
      upload: NO_UPLOAD,
    };
  }
  try {
    return {
      ...(await createBinaryWithUploads(hotCodePush, request, files, reporter)),
      channelId,
      skippedReason: null,
    };
  } catch (error) {
    // A local build never breaks: a failed creation is one warning. CI fails with it, since what it ships must name its channel.
    if (isCi()) {
      return resolveFailedCreation(channelId, error);
    }
    return {
      binary: null,
      channelId,
      skippedReason: `the binary was not created: ${resolveFailureText(error)}`,
      upload: NO_UPLOAD,
    };
  }
}

async function createBinaryWithUploads(
  hotCodePush: HotCodePush,
  request: BinaryCreationRequest,
  files: BundleFile[],
  reporter: ReturnType<typeof createReporter>,
): Promise<{ binary: Binary; upload: UploadedFiles }> {
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
    return { binary, upload: NO_UPLOAD };
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
    return { binary, upload: uploadedFiles };
  }
}

// The CLI reads no project file for the identity.
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

function resolveFailedCreation(
  channelId: string | null,
  pipelineFailure: unknown,
): BinaryCreation {
  return {
    binary: null,
    channelId,
    pipelineFailure,
    skippedReason: null,
    upload: NO_UPLOAD,
  };
}

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
      ? ': it names no channel and takes no OTA updates until it is built with a token, and no binary was created'
      : ' and no binary was created';
  const fixText =
    offlineCause === 'offline-switch'
      ? ''
      : '; run "hotcodepush login" or set HOTCODEPUSH_TOKEN';
  return `${causeText}, so the build was made offline${consequenceText}${fixText}.`;
}
