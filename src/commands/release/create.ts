import type {
  Audience,
  Bundle,
  Channel,
  CreateReleaseOptions,
  HotCodePush,
  Release,
} from '@hotcodepush/node';
import { z } from 'zod';
import { fetchPlatform } from '../../frameworks/platform.js';
import { fetchAppId } from '../../resources/apps.js';
import {
  resolveAudienceText,
  resolveCountText,
} from '../../resources/audience.js';
import { fetchBundle, resolveBundleLabel } from '../../resources/bundles.js';
import {
  channelOptionShape,
  fetchChannelId,
  fetchChannels,
} from '../../resources/channels/fetch.js';
import type { FailurePolicyOptions } from '../../resources/channels/fields.js';
import {
  failurePolicyShape,
  resolveFailurePolicy,
} from '../../resources/channels/fields.js';
import type {
  ConditionOptions,
  AudienceQuery,
} from '../../resources/releases/conditions.js';
import {
  buildAudienceQuery,
  buildReleaseConditions,
  conditionOptionShape,
} from '../../resources/releases/conditions.js';
import {
  fetchReleaseLog,
  waitUntilLive,
} from '../../resources/releases/fetch.js';
import { printCreatedRelease } from '../../resources/releases/output.js';
import type {
  Progression,
  ProgressionOptions,
} from '../../resources/releases/progression.js';
import {
  progressionShape,
  resolveProgression,
  resolveProgressionText,
} from '../../resources/releases/progression.js';
import { findNewestActiveRelease } from '../../resources/releases/serving.js';
import type { BundleUploadOptions } from '../../upload/bundle-upload.js';
import {
  bundleUploadOptionShape,
  buildBundleUpload,
} from '../../upload/bundle-upload.js';
import { withTemporaryDirectory } from '../../upload/compressed-files.js';
import type { Platform, UploadBundleOptions } from '../../upload/upload.js';
import {
  assertWithinBundleBytesLimit,
  collectUploadFiles,
  uploadBundle,
} from '../../upload/upload.js';
import { createApiClient } from '../../utils/api-client.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import { defineCommand } from '../../utils/command.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printWarnings } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { fetchResourceId } from '../../utils/resources.js';

type BundleSource =
  { bundle: Bundle } | { bundleUpload: UploadBundleOptions } | SourceRelease;

interface ChannelAudience {
  audience: Audience;
  channel: Channel;
}

interface SourceRelease {
  bundle: Bundle;
  platform: Platform | null;
  sourceChannel: Channel;
  sourceRelease: Release;
}

type ReleaseBody = Omit<
  CreateReleaseOptions,
  'appId' | 'channelId' | 'idempotencyKey'
>;

interface ReleaseCreateOptions
  extends
    BundleUploadOptions,
    ConditionOptions,
    FailurePolicyOptions,
    ProgressionOptions {
  bundle?: string;
  channel?: string;
  dryRun?: boolean;
  fromChannel?: string;
  mandatory?: boolean;
  notes?: string;
  rolloutPercent?: number;
}

interface ReleasePlan {
  bundleSource: BundleSource;
  channelAudience: ChannelAudience;
  consequence: string;
  fingerprint: string | null;
  rollout: ReleaseRollout;
}

interface ReleaseRollout {
  isMandatory: boolean;
  progression: Progression | null;
  rolloutPercent: number;
}

export default defineCommand({
  description:
    'Release a bundle to a channel, uploading the build first unless --bundle or --from-channel names one, and wait until it is live.',
  examples: [
    'hotcodepush release create --path dist',
    'hotcodepush release create --from-channel staging --channel production --binary-version ">=2.3.0" --progression --dry-run',
  ],
  options: defineCommandOptions({
    ...bundleUploadOptionShape,
    ...channelOptionShape,
    ...conditionOptionShape,
    ...failurePolicyShape,
    ...progressionShape,
    bundle: z
      .string()
      .optional()
      .describe(
        'A bundle already uploaded, by number or id. Without it the build is uploaded first.',
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'Validate and print the audience the release would reach. Nothing is signed, uploaded or published, so no private key is needed.',
      ),
    fromChannel: z
      .string()
      .optional()
      .describe(
        'Release the bundle of the newest active release this channel serves on the platform, by id or name, instead of a bundle or a build.',
      ),
    mandatory: booleanFlagSchema
      .optional()
      .describe('Devices apply the release at once and restart.'),
    notes: z
      .string()
      .optional()
      .describe('The release notes. They ride the public index.'),
    rolloutPercent: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe(
        "The share of devices the release reaches, 0 to 100; 100 by default, the schedule's first percentage with --progression.",
      ),
  }),
  action: options =>
    withTemporaryDirectory(packagingDirectoryPath =>
      createRelease(options, packagingDirectoryPath),
    ),
});

// A dry run still hashes a web build and checks the size limit, but uploads nothing.
async function assertBundleWithinLimit(
  bundleSource: BundleSource,
): Promise<void> {
  if ('bundleUpload' in bundleSource) {
    assertWithinBundleBytesLimit(
      await collectUploadFiles(bundleSource.bundleUpload),
    );
  }
}

function assertOneBundleSource(options: ReleaseCreateOptions): void {
  const sourceFlags = [
    options.bundle === undefined ? undefined : '--bundle',
    options.fromChannel === undefined ? undefined : '--from-channel',
    options.path === undefined ? undefined : '--path',
  ].filter(flag => flag !== undefined);
  if (sourceFlags.length > 1) {
    throw new InvalidParameterError(
      `The flags ${sourceFlags.join(' and ')} were passed together.`,
      {
        fix: 'Pass one of them: the bundle to release, the channel to release from or the build to upload.',
      },
    );
  }
}

function buildReleaseBody(
  bundle: Bundle,
  {
    options,
    plan: { bundleSource, fingerprint, rollout },
  }: { options: ReleaseCreateOptions; plan: ReleasePlan },
): ReleaseBody {
  return {
    ...('sourceChannel' in bundleSource
      ? {
          fromChannelId: bundleSource.sourceChannel.id,
          platform: bundleSource.platform,
        }
      : { bundleId: bundle.id, platform: options.platform ?? null }),
    conditions: buildReleaseConditions(options, { fingerprint }),
    ...resolveFailurePolicy(options),
    isMandatory: rollout.isMandatory,
    notes: options.notes ?? null,
    progression: rollout.progression ?? undefined,
    rolloutPercent: rollout.rolloutPercent,
  };
}

// The packaging directory is removed when the command ends.
async function createRelease(
  options: ReleaseCreateOptions,
  packagingDirectoryPath: string,
): Promise<void> {
  const hotCodePush = createApiClient();
  const plan = await fetchReleasePlan(hotCodePush, {
    options,
    packagingDirectoryPath,
  });
  const { audience, channel } = plan.channelAudience;
  if (options.dryRun) {
    await assertBundleWithinLimit(plan.bundleSource);
    printWarnings(audience.warnings);
    if (options.json) {
      printJson({ ...audience, channelId: channel.id });
    } else {
      console.log(`Dry run, nothing published: this ${plan.consequence}.`);
    }
    return;
  }
  if (!(await confirmConsequence(plan.consequence, options))) {
    return;
  }
  const bundle = await uploadReleasedBundle(hotCodePush, plan.bundleSource);
  const liveRelease = await createLiveRelease(hotCodePush, {
    channel,
    releaseBody: buildReleaseBody(bundle, { options, plan }),
  });
  printWarnings(audience.warnings);
  if (options.json) {
    printJson(liveRelease);
  } else {
    printCreatedRelease(liveRelease, {
      bundleLabel: resolveBundleLabel(bundle),
      channelName: channel.name,
    });
  }
}

async function createLiveRelease(
  hotCodePush: HotCodePush,
  { channel, releaseBody }: { channel: Channel; releaseBody: ReleaseBody },
): Promise<Release> {
  const createdRelease = await hotCodePush.apps.channels.releases.create({
    ...releaseBody,
    appId: channel.appId,
    channelId: channel.id,
  });
  return waitUntilLive(hotCodePush, {
    appId: channel.appId,
    relations: ['bundle', 'channel'],
    releaseId: createdRelease.id,
  });
}

function fetchAudience(
  hotCodePush: HotCodePush,
  {
    audienceQuery,
    channel,
  }: { audienceQuery: AudienceQuery; channel: Channel },
): Promise<Audience> {
  return hotCodePush.apps.channels.audience.get({
    ...audienceQuery,
    appId: channel.appId,
    channelId: channel.id,
  });
}

// The upload runs only once the release is confirmed.
async function fetchBundleSource(
  hotCodePush: HotCodePush,
  {
    options,
    packagingDirectoryPath,
  }: { options: ReleaseCreateOptions; packagingDirectoryPath: string },
): Promise<BundleSource> {
  assertOneBundleSource(options);
  if (options.bundle === undefined && options.fromChannel === undefined) {
    return {
      bundleUpload: await buildBundleUpload(hotCodePush, {
        isDryRun: options.dryRun,
        options,
        packagingDirectoryPath,
      }),
    };
  }
  const appId = await fetchAppId(hotCodePush, {
    options,
    projectConfig: readProjectConfig(options.config),
  });
  return options.fromChannel === undefined
    ? { bundle: await fetchBundle(hotCodePush, { appId, options }) }
    : fetchSourceRelease(hotCodePush, {
        appId,
        platform: await fetchPlatform(hotCodePush, { appId, options }),
        reference: options.fromChannel,
      });
}

// The audience preview checks the conditions before anything is uploaded.
async function fetchChannelAudience(
  hotCodePush: HotCodePush,
  {
    appId,
    fingerprint,
    options,
    rolloutPercent,
  }: {
    appId: string;
    fingerprint: string | null;
    options: ReleaseCreateOptions;
    rolloutPercent: number;
  },
): Promise<ChannelAudience> {
  const channel = await hotCodePush.apps.channels.get({
    appId,
    channelId: await fetchChannelId(hotCodePush, {
      appId,
      options,
      projectConfig: readProjectConfig(options.config),
    }),
  });
  const audience = await fetchAudience(hotCodePush, {
    audienceQuery: buildAudienceQuery(options, {
      fingerprint,
      rolloutPercent,
    }),
    channel,
  });
  return { audience, channel };
}

// Everything the confirmation names is known before anything is uploaded or released.
async function fetchReleasePlan(
  hotCodePush: HotCodePush,
  {
    options,
    packagingDirectoryPath,
  }: { options: ReleaseCreateOptions; packagingDirectoryPath: string },
): Promise<ReleasePlan> {
  const progression = resolveProgression(options);
  const bundleSource = await fetchBundleSource(hotCodePush, {
    options,
    packagingDirectoryPath,
  });
  const fingerprint = resolveSourceFingerprint(bundleSource);
  const rollout = resolveRollout(options, { progression });
  const channelAudience = await fetchChannelAudience(hotCodePush, {
    appId: resolveSourceAppId(bundleSource),
    fingerprint,
    options,
    rolloutPercent: rollout.rolloutPercent,
  });
  return {
    bundleSource,
    channelAudience,
    consequence: resolveReleaseConsequence(bundleSource, {
      channelAudience,
      platform: options.platform ?? null,
      rollout,
    }),
    fingerprint,
    rollout,
  };
}

// Mirrors the API, which releases the newest active release of that channel serving the platform.
async function fetchSourceRelease(
  hotCodePush: HotCodePush,
  {
    appId,
    platform,
    reference,
  }: { appId: string; platform: Platform | null; reference: string },
): Promise<SourceRelease> {
  const sourceChannel = await hotCodePush.apps.channels.get({
    appId,
    channelId: await fetchResourceId({
      fetchResources: () => fetchChannels(hotCodePush, appId),
      noun: 'channel',
      reference,
      source: '--from-channel',
    }),
  });
  const sourceRelease = findNewestActiveRelease(
    await fetchReleaseLog(hotCodePush, sourceChannel),
    { platform },
  );
  if (sourceRelease === undefined) {
    throw new InvalidParameterError(
      `The channel ${sourceChannel.name} from --from-channel serves no active release${platform === null ? '' : ` on ${platform}`}.`,
      { fix: 'Release a bundle to that channel first with release create.' },
    );
  }
  const bundle =
    sourceRelease.bundle ??
    (await hotCodePush.apps.bundles.get({
      appId,
      bundleId: sourceRelease.bundleId,
    }));
  return { bundle, platform, sourceChannel, sourceRelease };
}

// The audience preview takes no platform, so the devices of one are its bucket of that platform.
function resolveReachText(
  { audience, channel }: ChannelAudience,
  {
    platform,
    rolloutPercent,
  }: { platform: Platform | null; rolloutPercent: number },
): string {
  if (platform === null) {
    return resolveAudienceText(audience, {
      channelName: channel.name,
      rolloutPercent,
    });
  }
  const platformDeviceCount =
    audience.platform.find(({ value }) => value === platform)?.deviceCount ?? 0;
  return `reaches ${resolveCountText(platformDeviceCount)} ${platform} devices in ${channel.name}`;
}

function resolveReleaseConsequence(
  bundleSource: BundleSource,
  {
    channelAudience,
    platform,
    rollout: { isMandatory, progression, rolloutPercent },
  }: {
    channelAudience: ChannelAudience;
    platform: Platform | null;
    rollout: ReleaseRollout;
  },
): string {
  const audienceText = resolveReachText(channelAudience, {
    platform,
    rolloutPercent,
  });
  const progressionText =
    progression === null
      ? ''
      : `, progressing through ${resolveProgressionText(progression)}`;
  return `${resolveReleaseText(bundleSource)} at ${rolloutPercent} percent${progressionText}${isMandatory ? ', mandatory' : ''}: ${audienceText}`;
}

function resolveReleaseText(bundleSource: BundleSource): string {
  if ('bundleUpload' in bundleSource) {
    return resolveUploadText(bundleSource.bundleUpload);
  }
  const bundleText = `releases bundle ${resolveBundleLabel(bundleSource.bundle)}`;
  return 'sourceChannel' in bundleSource
    ? `${bundleText}, release #${bundleSource.sourceRelease.number} of ${bundleSource.sourceChannel.name},`
    : bundleText;
}

function resolveRollout(
  options: ReleaseCreateOptions,
  { progression }: { progression: Progression | null },
): ReleaseRollout {
  return {
    isMandatory: options.mandatory ?? false,
    progression,
    rolloutPercent:
      options.rolloutPercent ?? progression?.rolloutPercents[0] ?? 100,
  };
}

function resolveSourceAppId(bundleSource: BundleSource): string {
  return 'bundle' in bundleSource
    ? bundleSource.bundle.appId
    : bundleSource.bundleUpload.appId;
}

// A project has one native contract, whatever the platform.
function resolveSourceFingerprint(bundleSource: BundleSource): string | null {
  return 'bundle' in bundleSource
    ? bundleSource.bundle.fingerprint
    : bundleSource.bundleUpload.fingerprint;
}

// A build still to upload has no number yet, so it is named by its version label.
// One bundle for both platforms is the web build. A bundle of one platform is named by it.
function resolveUploadText({
  bundleVersion,
  platforms,
}: UploadBundleOptions): string {
  return platforms.length > 1
    ? `uploads the web build as ${bundleVersion} and releases it`
    : `uploads the ${platforms.join(', ')} bundle as ${bundleVersion} and releases it`;
}

async function uploadReleasedBundle(
  hotCodePush: HotCodePush,
  bundleSource: BundleSource,
): Promise<Bundle> {
  return 'bundle' in bundleSource
    ? bundleSource.bundle
    : (await uploadBundle(hotCodePush, bundleSource.bundleUpload)).bundle;
}
