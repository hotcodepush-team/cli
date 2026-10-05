import type {
  Audience,
  Bundle,
  Channel,
  ChannelWithDeviceCounts,
  CreateReleaseOptions,
  CreatedRelease,
  HotCodePush,
  Release,
} from '@hotcodepush/node';
import {
  computeSha256Hex,
  stringifyCanonicalJson,
} from '@hotcodepush/protocol';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { resolveAudienceText } from '../../utils/audience.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import { collectBundleFiles } from '../../utils/bundle-files.js';
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
  fetchChannel,
  fetchChannels,
  fetchResourceId,
} from '../../utils/resource-resolution.js';
import type { UploadBundleOptions } from '../../utils/upload.js';
import {
  assertWithinBundleBytesLimit,
  uploadBundle,
} from '../../utils/upload.js';
import type { BundleUploadOptions } from '../bundle/upload.js';
import {
  bundleUploadOptionShape,
  resolveUploadBundleOptions,
} from '../bundle/upload.js';

/**
 * What a release is made of: the bundle `--bundle` names, what the channel `--from-channel` names serves,
 * or the builds to upload once the release is confirmed — the web build, or one bundle per platform where the
 * framework has one each, every one of them released.
 */
export type BundleSource =
  | { bundle: Bundle }
  | { bundle: Bundle; sourceChannel: Channel; sourceRelease: Release }
  | { bundleUploads: UploadBundleOptions[] };

/**
 * A channel the release goes to with the audience its conditions reach there.
 */
export interface ChannelAudience {
  audience: Audience;
  channel: ChannelWithDeviceCounts;
}

type ReleaseBody = Omit<
  CreateReleaseOptions,
  'appId' | 'channelId' | 'idempotencyKey'
>;

interface ReleaseCreateOptions
  extends BundleUploadOptions, ConditionOptions, FailurePolicyOptions {
  bundle?: string;
  channel?: string[];
  dryRun?: boolean;
  fromChannel?: string;
  mandatory?: boolean;
  notes?: string;
  rolloutPercentage?: number;
}

export default defineCommand({
  description:
    'Release a bundle to a channel, uploading the build first unless --bundle or --from-channel names one, and wait until it is live.',
  examples: [
    'hotcodepush release create --path dist',
    'hotcodepush release create --from-channel staging --channel production --binary ">=2.3.0" --rollout-percentage 10 --dry-run',
  ],
  options: defineCommandOptions({
    ...bundleUploadOptionShape,
    ...conditionOptionShape,
    ...failurePolicyShape,
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
        'Validate and print the audience the release would reach; nothing is uploaded or published.',
      ),
    fromChannel: z
      .string()
      .optional()
      .describe(
        'Release what this channel serves, by id or name, instead of a bundle or a build.',
      ),
    mandatory: booleanFlagSchema
      .optional()
      .describe('Devices install the release at once and restart.'),
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
        'The share of devices the release reaches, 0 to 100; 100 by default.',
      ),
  }),
  action: options =>
    withTemporaryDirectory(packagingDirectoryPath =>
      createReleases(options, packagingDirectoryPath),
    ),
});

/**
 * The command, with the directory a framework that packages inside the upload bundles into; it is gone when the command ends.
 */
async function createReleases(
  options: ReleaseCreateOptions,
  packagingDirectoryPath: string,
): Promise<void> {
  const hotCodePush = createApiClient();
  const bundleSource = await resolveBundleSource(
    hotCodePush,
    options,
    packagingDirectoryPath,
  );
  const fingerprint = resolveSourceFingerprint(bundleSource);
  const isMandatory = options.mandatory ?? false;
  const rolloutPercentage = options.rolloutPercentage ?? 100;
  const channelAudiences = await fetchChannelAudiences(
    hotCodePush,
    options,
    fingerprint,
    rolloutPercentage,
  );
  const consequence = resolveReleaseConsequence(
    bundleSource,
    channelAudiences,
    rolloutPercentage,
    isMandatory,
  );
  if (options.dryRun) {
    await printDryRun(bundleSource, channelAudiences, consequence, options);
    return;
  }
  if (!(await confirmConsequence(consequence, options))) {
    return;
  }
  const releases: CreatedRelease[] = [];
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
      rolloutPercentage,
    };
    for (const { channel } of channelAudiences) {
      const createdRelease = await hotCodePush.apps.channels.releases.create({
        ...releaseBody,
        appId: bundle.appId,
        channelId: channel.id,
        idempotencyKey: resolveIdempotencyKey(bundle, channel, releaseBody),
      });
      printWarnings(createdRelease.warnings);
      const liveRelease = await waitUntilLive(hotCodePush, createdRelease);
      releases.push({ ...liveRelease, warnings: createdRelease.warnings });
      if (!options.json) {
        printReleasedLine(
          liveRelease,
          channel.name,
          resolveBundleLabel(bundle),
        );
      }
    }
  }
  if (options.json) {
    printJson(releases);
  }
}

/**
 * What the release does, with the audience its conditions reach in every channel, from the audience preview.
 * A web build still to upload has no number yet, so it is named by the version label it will carry.
 */
export function resolveReleaseConsequence(
  bundleSource: BundleSource,
  channelAudiences: ChannelAudience[],
  rolloutPercentage: number,
  isMandatory: boolean,
): string {
  const audienceText = channelAudiences
    .map(({ audience, channel }) =>
      resolveAudienceText(audience, channel.name, rolloutPercentage),
    )
    .join(' and ');
  return `${resolveReleaseText(bundleSource)} at ${rolloutPercentage} percent${isMandatory ? ', mandatory' : ''}: ${audienceText}`;
}

/**
 * Every channel `--channel` names, or the project's one when none is named, each with the audience the release's
 * conditions reach there; the preview checks the conditions before anything is uploaded.
 */
async function fetchChannelAudiences(
  hotCodePush: HotCodePush,
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
  return Promise.all(
    channelReferences.map(async channelReference => {
      const channel = await fetchChannel(hotCodePush, {
        ...options,
        channel: channelReference,
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

/**
 * The newest active release of the channel `--from-channel` names, with its bundle: what the API releases from there.
 */
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
  ).find(({ state }) => state === 'active');
  if (sourceRelease === undefined) {
    throw new InvalidParameterError(
      `--from-channel: the channel ${sourceChannel.name} serves no active release`,
      undefined,
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

/**
 * The dry run's answer: the consequence as the confirmation would state it and the warnings of the preview;
 * a web build is hashed and checked against the size limit, and nothing is uploaded or published.
 */
async function printDryRun(
  bundleSource: BundleSource,
  channelAudiences: ChannelAudience[],
  consequence: string,
  options: ReleaseCreateOptions,
): Promise<void> {
  if ('bundleUploads' in bundleSource) {
    for (const { directoryPath } of bundleSource.bundleUploads) {
      assertWithinBundleBytesLimit(await collectBundleFiles(directoryPath));
    }
  }
  for (const { audience } of channelAudiences) {
    printWarnings(audience.warnings);
  }
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

/**
 * `--bundle` names an uploaded bundle and `--from-channel` what a channel serves; otherwise the web build under `--path`
 * is resolved for `bundle upload`'s upload, which runs only once the release is confirmed.
 */
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
      `${sourceFlags.join(' and ')}: pass one of them, the bundle to release, the channel to release from or the build to upload`,
      undefined,
    );
  }
  if (options.bundle === undefined && options.fromChannel === undefined) {
    return {
      bundleUploads: await resolveUploadBundleOptions(
        hotCodePush,
        options,
        packagingDirectoryPath,
      ),
    };
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

/**
 * The bundles the release carries: the one named, or each build uploaded first when that is the source, its warnings printed.
 */
async function resolveReleasedBundles(
  hotCodePush: HotCodePush,
  bundleSource: BundleSource,
): Promise<Bundle[]> {
  if ('bundle' in bundleSource) {
    return [bundleSource.bundle];
  }
  const bundles: Bundle[] = [];
  for (const uploadBundleOptions of bundleSource.bundleUploads) {
    const uploadedBundle = await uploadBundle(hotCodePush, uploadBundleOptions);
    printWarnings(uploadedBundle.warnings);
    bundles.push(uploadedBundle.bundle);
  }
  return bundles;
}

/**
 * The key a pipeline that retries after a timeout sends again: the same bundle to the same channel with the same
 * body is the same release, and a deliberate second release with other flags is a new one.
 */
function resolveIdempotencyKey(
  bundle: Bundle,
  channel: ChannelWithDeviceCounts,
  releaseBody: ReleaseBody,
): string {
  return computeSha256Hex(
    `${bundle.manifestSha256 ?? bundle.id}:${channel.id}:${stringifyCanonicalJson(releaseBody)}`,
  );
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

/**
 * A build still to upload has no number yet, so it is named by the version label it will carry: one bundle for both
 * platforms is the web build, the bundles of a framework that has one per platform are named by their platforms.
 */
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

/**
 * The fingerprint the release's condition carries: the bundle's own, or the one the builds will be uploaded with,
 * the project's one native contract whatever the platform.
 */
function resolveSourceFingerprint(bundleSource: BundleSource): string | null {
  return 'bundle' in bundleSource
    ? bundleSource.bundle.fingerprint
    : (bundleSource.bundleUploads[0]?.fingerprint ?? null);
}
