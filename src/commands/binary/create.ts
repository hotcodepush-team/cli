import type {
  Binary,
  CreateBinaryOptions,
  HotCodePush,
} from '@hotcodepush/node';
import { z } from 'zod';
import type { BuildStep, OfflineCause } from '../../frameworks/build-step.js';
import {
  buildStepShape,
  fetchBuildStepChannelId,
  printWrittenResourceFile,
  readBuildStep,
  resolveChannelIdByShape,
  resolveFailureText,
  resolveOfflineCause,
  writeBuildResourceFile,
} from '../../frameworks/build-step.js';
import { assertMissingParameter } from '../../frameworks/framework.js';
import type { BundleFile } from '../../upload/bundle-files.js';
import {
  compressFiles,
  withTemporaryDirectory,
} from '../../upload/compressed-files.js';
import type { Platform, UploadedFiles } from '../../upload/upload.js';
import {
  resolveUploadedFilesText,
  assertWithinBundleBytesLimit,
  resolveMissingSha256s,
  uploadMissingFiles,
} from '../../upload/upload.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printNotice, printWarning } from '../../utils/diagnostics.js';
import { isCi } from '../../utils/environment.js';
import { CliError, PipelineNotLoggedInError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import type { Reporter } from '../../utils/progress.js';
import { createReporter } from '../../utils/progress.js';

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

interface BinaryUploadRequest {
  files: BundleFile[];
  reporter: Reporter;
  request: BinaryCreationRequest;
}

const NO_UPLOAD: UploadedFiles = { fileCount: 0, sizeBytes: 0 };

export default defineCommand({
  description:
    'The build step of a store build: creates the binary with the embedded bundle it ships and writes the resource file the SDK reads, naming that bundle. Every other build runs resource-file write. HOTCODEPUSH_OFFLINE=1 builds without the API, naming no channel unless it is given by id and creating no binary.',
  authentication: 'optional',
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
      writeDebugBuildResourceFile(buildStep, options);
      return;
    }
    assertWithinBundleBytesLimit(embeddedFiles);
    const identity = resolveBinaryIdentity(options);
    const binaryCreation = await createBuildBinary(buildStep, {
      files: embeddedFiles,
      reporter: createReporter(options),
      request: resolveCreationRequest(buildStep, {
        identity,
        isForced: options.force ?? false,
      }),
    });
    writeBuildResourceFile(buildStep, {
      channelId: binaryCreation.channelId,
      embeddedBundle: {
        bundleVersion: identity.binaryVersion,
        files: embeddedFiles,
        id: binaryCreation.binary?.bundleId ?? null,
      },
    });
    if (binaryCreation.pipelineFailure !== undefined) {
      throw binaryCreation.pipelineFailure;
    }
    if (binaryCreation.skippedReason !== null) {
      printWarning(binaryCreation.skippedReason);
    }
    printBinaryCreation(binaryCreation, {
      identity,
      options,
      platform,
      resourceFilePath,
    });
  },
});

function buildCreateBinaryOptions(
  { binaryBuild, binaryVersion, ...identityless }: BinaryCreationRequest,
  files: BundleFile[],
): CreateBinaryOptions {
  return {
    ...identityless,
    build: binaryBuild,
    files: files.map(({ path, sha256, sizeBytes }) => ({
      path,
      sha256,
      sizeBytes,
    })),
    version: binaryVersion,
  };
}

async function createBinaryInChannel(
  hotCodePush: HotCodePush,
  { channelId, ...uploadRequest }: BinaryUploadRequest & { channelId: string },
): Promise<BinaryCreation> {
  try {
    return {
      ...(await createBinaryWithUploads(hotCodePush, uploadRequest)),
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
      skippedReason: `The binary was not created: ${resolveFailureText(error)}`,
      upload: NO_UPLOAD,
    };
  }
}

async function createBinaryWithUploads(
  hotCodePush: HotCodePush,
  { files, reporter, request }: BinaryUploadRequest,
): Promise<{ binary: Binary; upload: UploadedFiles }> {
  const createOptions = buildCreateBinaryOptions(request, files);
  try {
    const binary = await hotCodePush.apps.binaries.create(createOptions);
    return { binary, upload: NO_UPLOAD };
  } catch (error) {
    const missingSha256s = resolveMissingSha256s(error);
    if (missingSha256s === undefined) {
      throw error;
    }
    const uploadedFiles = await uploadFilesTheBinaryLacks(hotCodePush, {
      appId: request.appId,
      files,
      missingSha256s,
      reporter,
    });
    const binary = await hotCodePush.apps.binaries.create(createOptions);
    return { binary, upload: uploadedFiles };
  }
}

async function createBuildBinary(
  buildStep: BuildStep,
  { files, reporter, request }: BinaryUploadRequest,
): Promise<BinaryCreation> {
  const channelIdByShape = resolveChannelIdByShape(buildStep.channelReference);
  const offlineCause = resolveOfflineCause();
  if (offlineCause !== undefined) {
    return resolveOfflineCreation(offlineCause, channelIdByShape);
  }
  const hotCodePush = createApiClient();
  let channelId: string;
  try {
    channelId =
      channelIdByShape ??
      (await fetchBuildStepChannelId(hotCodePush, buildStep));
  } catch (error) {
    return resolveChannelFailure(error);
  }
  return createBinaryInChannel(hotCodePush, {
    channelId,
    files,
    reporter,
    request,
  });
}

function printBinaryCreation(
  binaryCreation: BinaryCreation,
  {
    identity,
    options,
    platform,
    resourceFilePath,
  }: {
    identity: BinaryIdentity;
    options: { json?: boolean };
    platform: Platform;
    resourceFilePath: string;
  },
): void {
  if (options.json) {
    printJson({
      binary: binaryCreation.binary,
      resourceFilePath,
      upload: binaryCreation.upload,
    });
    return;
  }
  if (binaryCreation.binary === null) {
    printWrittenResourceFile(resourceFilePath, { platform });
    return;
  }
  printCreatedBinary(binaryCreation.binary, {
    identity,
    resourceFilePath,
    upload: binaryCreation.upload,
  });
}

function printCreatedBinary(
  binary: Binary,
  {
    identity,
    resourceFilePath,
    upload,
  }: {
    identity: BinaryIdentity;
    resourceFilePath: string;
    upload: UploadedFiles;
  },
): void {
  printResult({
    rows: [
      ['ID', binary.id],
      ['Version', identity.binaryVersion],
      ['Build', identity.binaryBuild],
      ['Bundle ID', binary.bundleId],
      ['Resource file', resourceFilePath],
      ['Uploaded', resolveUploadedFilesText(upload)],
    ],
    sentence: `Created the ${binary.platform} binary.`,
  });
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

function resolveChannelFailure(error: unknown): BinaryCreation {
  if (error instanceof CliError) {
    throw error;
  }
  if (isCi()) {
    return resolveFailedCreation(null, error);
  }
  return {
    binary: null,
    channelId: null,
    skippedReason: `The channel could not be resolved, so the build names none and takes no OTA updates, and no binary was created: ${resolveFailureText(error)}`,
    upload: NO_UPLOAD,
  };
}

function resolveCreationRequest(
  { fingerprint, platform, projectConfig }: BuildStep,
  { identity, isForced }: { identity: BinaryIdentity; isForced: boolean },
): BinaryCreationRequest {
  return {
    ...identity,
    appId: projectConfig.appId,
    fingerprint,
    force: isForced,
    platform,
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

function resolveOfflineCreation(
  offlineCause: OfflineCause,
  channelIdByShape: string | null,
): BinaryCreation {
  if (offlineCause === 'no-token' && isCi()) {
    return resolveFailedCreation(
      channelIdByShape,
      new PipelineNotLoggedInError(),
    );
  }
  return {
    binary: null,
    channelId: channelIdByShape,
    skippedReason: resolveOfflineText(offlineCause, channelIdByShape),
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
      : 'Not logged in';
  const consequenceText =
    channelId === null
      ? '. It names no channel and takes no OTA updates until it is built with a token, and no binary was created'
      : ' and no binary was created';
  const fixText =
    offlineCause === 'offline-switch'
      ? ''
      : '. Run "hotcodepush login" or set HOTCODEPUSH_TOKEN';
  return `${causeText}, so the build was made offline${consequenceText}${fixText}.`;
}

async function uploadFilesTheBinaryLacks(
  hotCodePush: HotCodePush,
  {
    appId,
    files,
    missingSha256s,
    reporter,
  }: {
    appId: string;
    files: BundleFile[];
    missingSha256s: string[];
    reporter: Reporter;
  },
): Promise<UploadedFiles> {
  reporter.report(`Uploading ${missingSha256s.length} files the app lacks…`);
  return withTemporaryDirectory(async temporaryDirectoryPath =>
    uploadMissingFiles(hotCodePush, {
      appId,
      compressedFiles: await compressFiles(
        files.filter(({ sha256 }) => missingSha256s.includes(sha256)),
        temporaryDirectoryPath,
      ),
      missingSha256s,
      reporter,
    }),
  );
}

function writeDebugBuildResourceFile(
  buildStep: BuildStep,
  options: { json?: boolean },
): void {
  const { platform, resourceFilePath } = buildStep;
  writeBuildResourceFile(buildStep, {
    channelId: resolveChannelIdByShape(buildStep.channelReference),
    embeddedBundle: null,
  });
  printNotice(
    `No binary created: the ${platform} build bundled no JavaScript, as a debug build served by the development server does. Wrote ${resourceFilePath} without an embedded bundle: over-the-air (OTA) updates are off in this build.`,
  );
  if (options.json) {
    printJson({ binary: null, resourceFilePath, upload: NO_UPLOAD });
  }
}
