import type {
  Audience,
  Bundle,
  Channel,
  CreateReleaseOptions,
  HotCodePush,
  Release,
} from '@hotcodepush/node';
import { z } from 'zod';
import { fetchAppId } from '../../resources/apps.js';
import { resolveAudienceText } from '../../resources/audience.js';
import { fetchBundle, resolveBundleLabel } from '../../resources/bundles.js';
import {
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
import type { BundleUploadOptions } from '../../upload/bundle-upload.js';
import {
  bundleUploadOptionShape,
  buildBundleUploads,
} from '../../upload/bundle-upload.js';
import { withTemporaryDirectory } from '../../upload/compressed-files.js';
import type { UploadBundleOptions } from '../../upload/upload.js';
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
import {
  printJson,
  printResultGap,
  printWarnings,
} from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { fetchResourceId } from '../../utils/resources.js';

type BundleSource =
  | { bundle: Bundle }
  | { bundle: Bundle; sourceChannel: Channel; sourceRelease: Release }
  | { appId: string; bundleUploads: UploadBundleOptions[] };

interface ChannelAudience {
  audience: Audience;
  channel: Channel;
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
  channel?: string[];
  dryRun?: boolean;
  fromChannel?: string;
  mandatory?: boolean;
  notes?: string;
  rolloutPercent?: number;
}

interface ReleasePlan {
  bundleSource: BundleSource;
  channelAudiences: ChannelAudience[];
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
    ...conditionOptionShape,
    ...failurePolicyShape,
    ...progressionShape,
    bundle: z
      .string()
      .optional()
      .describe(
        'A bundle already uploaded, by number or id. Without it the build is uploaded first.',
      ),
    channel: z
      .array(z.string())
      .optional()
      .describe(
        "The channel, by id or name, repeatable. Defaults to hotcodepush.json's channel.",
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
        'Release what this channel serves, by id or name, instead of a bundle or a build.',
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
      createReleases(options, packagingDirectoryPath),
    ),
});

function buildReleaseBody(
  bundle: Bundle,
  {
    options,
    plan: { bundleSource, fingerprint, rollout },
  }: { options: ReleaseCreateOptions; plan: ReleasePlan },
): ReleaseBody {
  return {
    ...('sourceChannel' in bundleSource
      ? { fromChannelId: bundleSource.sourceChannel.id }
      : { bundleId: bundle.id }),
    conditions: buildReleaseConditions(options, fingerprint),
    ...resolveFailurePolicy(options),
    isMandatory: rollout.isMandatory,
    notes: options.notes ?? null,
    progression: rollout.progression ?? undefined,
    rolloutPercent: rollout.rolloutPercent,
  };
}

async function createLiveRelease(
  hotCodePush: HotCodePush,
  {
    bundle,
    channel,
    options,
    releaseBody,
  }: {
    bundle: Bundle;
    channel: Channel;
    options: ReleaseCreateOptions;
    releaseBody: ReleaseBody;
  },
): Promise<Release> {
  const createdRelease = await hotCodePush.apps.channels.releases.create({
    ...releaseBody,
    appId: bundle.appId,
    channelId: channel.id,
  });
  const liveRelease = await waitUntilLive(hotCodePush, {
    appId: bundle.appId,
    relations: ['bundle', 'channel'],
    releaseId: createdRelease.id,
  });
  if (!options.json) {
    printCreatedRelease(liveRelease, {
      bundleLabel: resolveBundleLabel(bundle),
      channelName: channel.name,
    });
  }
  return liveRelease;
}

// The packaging directory is removed when the command ends.
async function createReleases(
  options: ReleaseCreateOptions,
  packagingDirectoryPath: string,
): Promise<void> {
  const hotCodePush = createApiClient();
  const plan = await fetchReleasePlan(hotCodePush, {
    options,
    packagingDirectoryPath,
  });
  if (options.dryRun) {
    await printDryRun(plan, options);
    return;
  }
  if (!(await confirmConsequence(plan.consequence, options))) {
    return;
  }
  const releases = await publishReleases(hotCodePush, { options, plan });
  printAudienceWarnings(plan.channelAudiences);
  if (options.json) {
    printJson(releases);
  }
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
  if (options.bundle === undefined && options.fromChannel === undefined) {
    return buildBundleUploads(hotCodePush, {
      isDryRun: options.dryRun,
      options,
      packagingDirectoryPath,
    });
  }
  const appId = await fetchAppId(hotCodePush, {
    options,
    projectConfig: readProjectConfig(options.config),
  });
  return options.fromChannel === undefined
    ? { bundle: await fetchBundle(hotCodePush, { appId, options }) }
    : fetchSourceRelease(hotCodePush, {
        appId,
        reference: options.fromChannel,
      });
}

// The audience preview checks the conditions before anything is uploaded.
async function fetchChannelAudiences(
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
): Promise<ChannelAudience[]> {
  const channelReferences =
    options.channel === undefined || options.channel.length === 0
      ? [undefined]
      : options.channel;
  const audienceQuery = buildAudienceQuery(options, {
    fingerprint,
    rolloutPercent,
  });
  const projectConfig = readProjectConfig(options.config);
  return Promise.all(
    channelReferences.map(async channelReference => {
      const channel = await hotCodePush.apps.channels.get({
        appId,
        channelId: await fetchChannelId(hotCodePush, {
          appId,
          options: { ...options, channel: channelReference },
          projectConfig,
        }),
      });
      return {
        audience: await fetchAudience(hotCodePush, { audienceQuery, channel }),
        channel,
      };
    }),
  );
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
  const rollout = resolveRollout(options, progression);
  const channelAudiences = await fetchChannelAudiences(hotCodePush, {
    appId: resolveSourceAppId(bundleSource),
    fingerprint,
    options,
    rolloutPercent: rollout.rolloutPercent,
  });
  return {
    bundleSource,
    channelAudiences,
    consequence: resolveReleaseConsequence(bundleSource, {
      channelAudiences,
      rollout,
    }),
    fingerprint,
    rollout,
  };
}

// Mirrors the API, which releases the newest active release of that channel.
async function fetchSourceRelease(
  hotCodePush: HotCodePush,
  { appId, reference }: { appId: string; reference: string },
): Promise<{ bundle: Bundle; sourceChannel: Channel; sourceRelease: Release }> {
  const sourceChannel = await hotCodePush.apps.channels.get({
    appId,
    channelId: await fetchResourceId({
      fetchResources: () => fetchChannels(hotCodePush, appId),
      noun: 'channel',
      reference,
      source: '--from-channel',
    }),
  });
  const sourceRelease = (
    await fetchReleaseLog(hotCodePush, sourceChannel)
  ).find(({ status }) => status === 'active');
  if (sourceRelease === undefined) {
    throw new InvalidParameterError(
      `The channel ${sourceChannel.name} from --from-channel serves no active release.`,
    );
  }
  const bundle =
    sourceRelease.bundle ??
    (await hotCodePush.apps.bundles.get({
      appId,
      bundleId: sourceRelease.bundleId,
    }));
  return { bundle, sourceChannel, sourceRelease };
}

// Each channel warns once, however many platform bundles the release carries.
function printAudienceWarnings(channelAudiences: ChannelAudience[]): void {
  for (const { audience } of channelAudiences) {
    printWarnings(audience.warnings);
  }
}

// A dry run still hashes a web build and checks the size limit, but uploads nothing.
async function printDryRun(
  { bundleSource, channelAudiences, consequence }: ReleasePlan,
  options: ReleaseCreateOptions,
): Promise<void> {
  if ('bundleUploads' in bundleSource) {
    for (const bundleUpload of bundleSource.bundleUploads) {
      assertWithinBundleBytesLimit(await collectUploadFiles(bundleUpload));
    }
  }
  printAudienceWarnings(channelAudiences);
  if (options.json) {
    printJson(
      channelAudiences.map(({ audience, channel }) => ({
        ...audience,
        channelId: channel.id,
      })),
    );
    return;
  }
  console.log(`Dry run, nothing published: this ${consequence}.`);
}

async function publishReleases(
  hotCodePush: HotCodePush,
  { options, plan }: { options: ReleaseCreateOptions; plan: ReleasePlan },
): Promise<Release[]> {
  const releases: Release[] = [];
  for (const bundle of await uploadReleasedBundles(
    hotCodePush,
    plan.bundleSource,
  )) {
    const releaseBody = buildReleaseBody(bundle, { options, plan });
    for (const { channel } of plan.channelAudiences) {
      if (!options.json && releases.length > 0) {
        printResultGap();
      }
      releases.push(
        await createLiveRelease(hotCodePush, {
          bundle,
          channel,
          options,
          releaseBody,
        }),
      );
    }
  }
  return releases;
}

function resolveReleaseConsequence(
  bundleSource: BundleSource,
  {
    channelAudiences,
    rollout: { isMandatory, progression, rolloutPercent },
  }: { channelAudiences: ChannelAudience[]; rollout: ReleaseRollout },
): string {
  const audienceText = channelAudiences
    .map(({ audience, channel }) =>
      resolveAudienceText(audience, {
        channelName: channel.name,
        rolloutPercent,
      }),
    )
    .join(' and ');
  const progressionText =
    progression === null
      ? ''
      : `, progressing through ${resolveProgressionText(progression)}`;
  return `${resolveReleaseText(bundleSource)} at ${rolloutPercent} percent${progressionText}${isMandatory ? ', mandatory' : ''}: ${audienceText}`;
}

function resolveReleaseText(bundleSource: BundleSource): string {
  if ('bundleUploads' in bundleSource) {
    return resolveUploadText(bundleSource.bundleUploads);
  }
  const bundleText = `releases bundle ${resolveBundleLabel(bundleSource.bundle)}`;
  return 'sourceChannel' in bundleSource
    ? `${bundleText}, release #${bundleSource.sourceRelease.number} of ${bundleSource.sourceChannel.name},`
    : bundleText;
}

function resolveRollout(
  options: ReleaseCreateOptions,
  progression: Progression | null,
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
    : bundleSource.appId;
}

// A project has one native contract, whatever the platform.
function resolveSourceFingerprint(bundleSource: BundleSource): string | null {
  return 'bundle' in bundleSource
    ? bundleSource.bundle.fingerprint
    : (bundleSource.bundleUploads[0]?.fingerprint ?? null);
}

// A build still to upload has no number yet, so it is named by its version label.
// One bundle for both platforms is the web build. Per-platform bundles are named by their platform.
function resolveUploadText(bundleUploads: UploadBundleOptions[]): string {
  const bundleVersion = bundleUploads[0]?.bundleVersion ?? '';
  const platformTexts = bundleUploads.map(({ platforms }) =>
    platforms.join(' and '),
  );
  if (bundleUploads.length === 1 && platformTexts[0]?.includes(' and ')) {
    return `uploads the web build as ${bundleVersion} and releases it`;
  }
  return bundleUploads.length === 1
    ? `uploads the ${platformTexts[0]} bundle as ${bundleVersion} and releases it`
    : `uploads the ${platformTexts.join(' and ')} bundles as ${bundleVersion} and releases each`;
}

async function uploadReleasedBundles(
  hotCodePush: HotCodePush,
  bundleSource: BundleSource,
): Promise<Bundle[]> {
  if ('bundle' in bundleSource) {
    return [bundleSource.bundle];
  }
  const bundles: Bundle[] = [];
  for (const uploadBundleOptions of bundleSource.bundleUploads) {
    bundles.push((await uploadBundle(hotCodePush, uploadBundleOptions)).bundle);
  }
  return bundles;
}
