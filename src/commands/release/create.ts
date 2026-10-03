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
 * or the web build to upload once the release is confirmed.
 */
export type BundleSource =
  | { bundle: Bundle }
  | { bundle: Bundle; sourceChannel: Channel; sourceRelease: Release }
  | { uploadBundleOptions: UploadBundleOptions };

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
    'Release a bundle to a channel, uploading the web build first unless --bundle or --from-channel names one, and wait until it is live.',
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
        'A bundle already uploaded, by number or id; without it the web build is uploaded first.',
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
        'Release what this channel serves, by id or name, instead of a bundle or a web build.',
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
  action: async options => {
    const hotCodePush = createApiClient();
    const bundleSource = await resolveBundleSource(hotCodePush, options);
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
    const bundle = await resolveReleasedBundle(hotCodePush, bundleSource);
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
    const releases: CreatedRelease[] = [];
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
    if (options.json) {
      printJson(releases);
    }
  },
});

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
  if ('uploadBundleOptions' in bundleSource) {
    assertWithinBundleBytesLimit(
      await collectBundleFiles(bundleSource.uploadBundleOptions.directoryPath),
    );
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
      uploadBundleOptions: await resolveUploadBundleOptions(
        hotCodePush,
        options,
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
 * The bundle the release carries, the web build uploaded first when that is the source, its warnings printed.
 */
async function resolveReleasedBundle(
  hotCodePush: HotCodePush,
  bundleSource: BundleSource,
): Promise<Bundle> {
  if ('bundle' in bundleSource) {
    return bundleSource.bundle;
  }
  const uploadedBundle = await uploadBundle(
    hotCodePush,
    bundleSource.uploadBundleOptions,
  );
  printWarnings(uploadedBundle.warnings);
  return uploadedBundle.bundle;
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
  if ('uploadBundleOptions' in bundleSource) {
    return `uploads the web build as ${bundleSource.uploadBundleOptions.bundleVersion} and releases it`;
  }
  const bundleText = `releases bundle ${resolveBundleLabel(bundleSource.bundle)}`;
  return 'sourceChannel' in bundleSource
    ? `${bundleText}, release #${bundleSource.sourceRelease.number} of ${bundleSource.sourceChannel.name},`
    : bundleText;
}

/**
 * The fingerprint the release's condition carries: the bundle's own, or the one the web build will be uploaded with.
 */
function resolveSourceFingerprint(bundleSource: BundleSource): string | null {
  return 'bundle' in bundleSource
    ? bundleSource.bundle.fingerprint
    : bundleSource.uploadBundleOptions.fingerprint;
}
