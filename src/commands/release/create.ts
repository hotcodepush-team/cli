import type {
  Audience,
  Bundle,
  Channel,
  CreateReleaseOptions,
  HotCodePush,
  Release,
} from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveAudienceText } from '../../utils/audience.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import {
  fetchBundle,
  resolveBundleLabel,
} from '../../utils/bundle-resolution.js';
import type { FailurePolicyOptions } from '../../utils/channel-fields.js';
import {
  failurePolicyShape,
  resolveFailurePolicy,
} from '../../utils/channel-fields.js';
import { withTemporaryDirectory } from '../../utils/compressed-files.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printWarnings } from '../../utils/output.js';
import type {
  Progression,
  ProgressionOptions,
} from '../../utils/progression.js';
import {
  progressionShape,
  resolveProgression,
  resolveProgressionText,
} from '../../utils/progression.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import type { ConditionOptions } from '../../utils/release-conditions.js';
import {
  buildAudienceQuery,
  buildReleaseConditions,
  conditionOptionShape,
} from '../../utils/release-conditions.js';
import { printReleasedLine } from '../../utils/release-output.js';
import {
  fetchReleaseLog,
  waitUntilLive,
} from '../../utils/release-resolution.js';
import {
  fetchAppId,
  fetchChannelId,
  fetchChannels,
  fetchResourceId,
} from '../../utils/resource-resolution.js';
import type { UploadBundleOptions } from '../../utils/upload.js';
import {
  assertWithinBundleBytesLimit,
  collectUploadFiles,
  uploadBundle,
} from '../../utils/upload.js';
import type { BundleUploadOptions } from '../bundle/upload.js';
import {
  bundleUploadOptionShape,
  resolveUploadBundleOptions,
} from '../bundle/upload.js';

export type BundleSource =
  | { bundle: Bundle }
  | { bundle: Bundle; sourceChannel: Channel; sourceRelease: Release }
  | { appId: string; bundleUploads: UploadBundleOptions[] };

export interface ChannelAudience {
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
  rolloutPercentage?: number;
}

export interface ReleaseRollout {
  isMandatory: boolean;
  progression: Progression | null;
  rolloutPercentage: number;
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
        'A bundle already uploaded, by number or id; without it the build is uploaded first.',
      ),
    channel: z
      .array(z.string())
      .optional()
      .describe(
        "The channel, by id or name, repeatable; hotcodepush.json's channel by default.",
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'Validate and print the audience the release would reach; nothing is signed, uploaded or published, so no private key is needed.',
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
      .describe('The release notes; they ride the public index.'),
    rolloutPercentage: z.coerce
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

// The packaging directory is removed when the command ends.
async function createReleases(
  options: ReleaseCreateOptions,
  packagingDirectoryPath: string,
): Promise<void> {
  const hotCodePush = createApiClient();
  const progression = resolveProgression(options);
  const bundleSource = await resolveBundleSource(
    hotCodePush,
    options,
    packagingDirectoryPath,
  );
  const fingerprint = resolveSourceFingerprint(bundleSource);
  const isMandatory = options.mandatory ?? false;
  const rolloutPercentage =
    options.rolloutPercentage ?? progression?.percentages[0] ?? 100;
  const appId =
    'bundle' in bundleSource ? bundleSource.bundle.appId : bundleSource.appId;
  const channelAudiences = await fetchChannelAudiences(
    hotCodePush,
    appId,
    options,
    fingerprint,
    rolloutPercentage,
  );
  const consequence = resolveReleaseConsequence(
    bundleSource,
    channelAudiences,
    { isMandatory, progression, rolloutPercentage },
  );
  if (options.dryRun) {
    await printDryRun(bundleSource, channelAudiences, consequence, options);
    return;
  }
  if (!(await confirmConsequence(consequence, options))) {
    return;
  }
  const releases: Release[] = [];
  for (const bundle of await resolveReleasedBundles(
    hotCodePush,
    bundleSource,
  )) {
    const releaseBody: ReleaseBody = {
      ...('sourceChannel' in bundleSource
        ? { fromChannelId: bundleSource.sourceChannel.id }
        : { bundleId: bundle.id }),
      conditions: buildReleaseConditions(options, fingerprint),
      ...resolveFailurePolicy(options),
      isMandatory,
      notes: options.notes ?? null,
      progression: progression ?? undefined,
      rolloutPercentage,
    };
    for (const { channel } of channelAudiences) {
      const createdRelease = await hotCodePush.apps.channels.releases.create({
        ...releaseBody,
        appId: bundle.appId,
        channelId: channel.id,
      });
      const liveRelease = await waitUntilLive(
        hotCodePush,
        bundle.appId,
        createdRelease.id,
        ['bundle', 'channel'],
      );
      releases.push(liveRelease);
      if (!options.json) {
        printReleasedLine(
          liveRelease,
          channel.name,
          resolveBundleLabel(bundle),
        );
      }
    }
  }
  printAudienceWarnings(channelAudiences);
  if (options.json) {
    printJson(releases);
  }
}

export function resolveReleaseConsequence(
  bundleSource: BundleSource,
  channelAudiences: ChannelAudience[],
  { isMandatory, progression, rolloutPercentage }: ReleaseRollout,
): string {
  const audienceText = channelAudiences
    .map(({ audience, channel }) =>
      resolveAudienceText(audience, channel.name, rolloutPercentage),
    )
    .join(' and ');
  const progressionText =
    progression === null
      ? ''
      : `, progressing through ${resolveProgressionText(progression)}`;
  return `${resolveReleaseText(bundleSource)} at ${rolloutPercentage} percent${progressionText}${isMandatory ? ', mandatory' : ''}: ${audienceText}`;
}

// The audience preview checks the conditions before anything is uploaded.
async function fetchChannelAudiences(
  hotCodePush: HotCodePush,
  appId: string,
  options: ReleaseCreateOptions,
  fingerprint: string | null,
  rolloutPercentage: number,
): Promise<ChannelAudience[]> {
  const channelReferences =
    options.channel === undefined || options.channel.length === 0
      ? [undefined]
      : options.channel;
  const audienceQuery = buildAudienceQuery(
    options,
    fingerprint,
    rolloutPercentage,
  );
  const projectConfig = readProjectConfig(options.config);
  return Promise.all(
    channelReferences.map(async channelReference => {
      const channel = await hotCodePush.apps.channels.get({
        appId,
        channelId: await fetchChannelId(
          hotCodePush,
          appId,
          { ...options, channel: channelReference },
          projectConfig,
        ),
      });
      const audience = await hotCodePush.apps.channels.audience.get({
        ...audienceQuery,
        appId: channel.appId,
        channelId: channel.id,
      });
      return { audience, channel };
    }),
  );
}

// Mirrors the API, which releases the newest active release of that channel.
async function fetchSourceRelease(
  hotCodePush: HotCodePush,
  appId: string,
  reference: string,
): Promise<{ bundle: Bundle; sourceChannel: Channel; sourceRelease: Release }> {
  const sourceChannel = await hotCodePush.apps.channels.get({
    appId,
    channelId: await fetchResourceId(
      'channel',
      reference,
      () => fetchChannels(hotCodePush, appId),
      '--from-channel',
    ),
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

// A dry run still hashes a web build and checks the size limit, but uploads nothing.
async function printDryRun(
  bundleSource: BundleSource,
  channelAudiences: ChannelAudience[],
  consequence: string,
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

// Each channel warns once, however many platform bundles the release carries.
function printAudienceWarnings(channelAudiences: ChannelAudience[]): void {
  for (const { audience } of channelAudiences) {
    printWarnings(audience.warnings);
  }
}

// The upload runs only once the release is confirmed.
async function resolveBundleSource(
  hotCodePush: HotCodePush,
  options: ReleaseCreateOptions,
  packagingDirectoryPath: string,
): Promise<BundleSource> {
  const sourceFlags = [
    options.bundle === undefined ? undefined : '--bundle',
    options.fromChannel === undefined ? undefined : '--from-channel',
    options.path === undefined ? undefined : '--path',
  ].filter(flag => flag !== undefined);
  if (sourceFlags.length > 1) {
    throw new InvalidParameterError(
      `The flags ${sourceFlags.join(' and ')} were passed together.`,
      'Pass one of them: the bundle to release, the channel to release from or the build to upload.',
    );
  }
  if (options.bundle === undefined && options.fromChannel === undefined) {
    return resolveUploadBundleOptions(
      hotCodePush,
      options,
      packagingDirectoryPath,
      { isDryRun: options.dryRun },
    );
  }
  const appId = await fetchAppId(
    hotCodePush,
    options,
    readProjectConfig(options.config),
  );
  return options.fromChannel === undefined
    ? { bundle: await fetchBundle(hotCodePush, appId, options) }
    : fetchSourceRelease(hotCodePush, appId, options.fromChannel);
}

async function resolveReleasedBundles(
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

function resolveReleaseText(bundleSource: BundleSource): string {
  if ('bundleUploads' in bundleSource) {
    return resolveUploadText(bundleSource.bundleUploads);
  }
  const bundleText = `releases bundle ${resolveBundleLabel(bundleSource.bundle)}`;
  return 'sourceChannel' in bundleSource
    ? `${bundleText}, release #${bundleSource.sourceRelease.number} of ${bundleSource.sourceChannel.name},`
    : bundleText;
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

// A project has one native contract, whatever the platform.
function resolveSourceFingerprint(bundleSource: BundleSource): string | null {
  return 'bundle' in bundleSource
    ? bundleSource.bundle.fingerprint
    : (bundleSource.bundleUploads[0]?.fingerprint ?? null);
}
