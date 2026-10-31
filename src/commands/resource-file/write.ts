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
import { CliError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';

interface ChannelResolution {
  channelId: string | null;
  skippedReason: string | null;
}

// Only `binary create` gives an embedded bundle a version, the version of the binary.
const UNVERSIONED_BUNDLE_VERSION = '';

export default defineCommand({
  description:
    'The build step of every build that is no store build: writes the resource file the SDK reads, listing the embedded bundle, and creates no binary. Without a token, offline or with an API that cannot be reached, the channel name stays unresolved and one warning says so, in CI too.',
  examples: [
    'hotcodepush resource-file write --platform ios --embedded-bundle-path build/App.app/public --resource-file-path build/App.app/hotcodepush.json',
    'hotcodepush resource-file write --platform android --embedded-bundle-path build/assets/public --resource-file-path build/assets/hotcodepush.json --json',
  ],
  options: defineCommandOptions(buildStepShape),
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
        `The ${platform} build bundled no JavaScript, as a debug build served by the development server does. Wrote ${resourceFilePath} without an embedded bundle: over-the-air (OTA) updates are off in this build.\n`,
      );
      if (options.json) {
        printJson({ resourceFilePath });
      }
      return;
    }
    const { channelId, skippedReason } = await resolveChannel(buildStep);
    writeBuildResourceFile(buildStep, channelId, {
      bundleVersion: UNVERSIONED_BUNDLE_VERSION,
      files: embeddedFiles,
      id: null,
    });
    if (skippedReason !== null) {
      process.stderr.write(`Warning: ${skippedReason}\n`);
    }
    if (options.json) {
      printJson({ resourceFilePath });
      return;
    }
    console.log(`Wrote ${resourceFilePath} for ${platform}.`);
  },
});

// Unlike `binary create`, this never fails offline or without a token, in a pipeline too.
async function resolveChannel(
  buildStep: BuildStep,
): Promise<ChannelResolution> {
  const channelIdByShape = resolveChannelIdByShape(buildStep.channelReference);
  if (channelIdByShape !== null) {
    return { channelId: channelIdByShape, skippedReason: null };
  }
  const offlineCause = resolveOfflineCause();
  if (offlineCause !== undefined) {
    return {
      channelId: null,
      skippedReason: resolveOfflineText(offlineCause),
    };
  }
  try {
    return {
      channelId: await fetchChannelId(createApiClient(), buildStep),
      skippedReason: null,
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    return {
      channelId: null,
      skippedReason: `the channel could not be resolved, so the build names none and takes no OTA updates: ${resolveFailureText(error)}`,
    };
  }
}

function resolveOfflineText(offlineCause: OfflineCause): string {
  return offlineCause === 'offline-switch'
    ? 'HOTCODEPUSH_OFFLINE is set, so the channel name was not resolved: the build names no channel and takes no OTA updates.'
    : 'not logged in, so the channel name was not resolved: the build names no channel and takes no OTA updates; run "hotcodepush login" or set HOTCODEPUSH_TOKEN.';
}
