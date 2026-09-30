import type {
  Bundle,
  ChannelWithDeviceCounts,
  CreateReleaseOptions,
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
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import {
  fetchBundle,
  resolveBundleLabel,
} from '../../utils/bundle-resolution.js';
import { InvalidParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { printReleasedLine } from '../../utils/release-output.js';
import { waitUntilLive } from '../../utils/release-resolution.js';
import { fetchAppId, fetchChannel } from '../../utils/resource-resolution.js';
import type { BundleUploadOptions } from '../bundle/upload.js';
import {
  bundleUploadOptionShape,
  uploadBundleFromOptions,
} from '../bundle/upload.js';

type ReleaseBody = Pick<
  CreateReleaseOptions,
  'bundleId' | 'isMandatory' | 'notes' | 'rolloutPercentage'
>;

interface ReleaseCreateOptions extends BundleUploadOptions {
  bundle?: string;
  channel?: string[];
  mandatory?: boolean;
  notes?: string;
  rolloutPercentage?: number;
}

export default defineCommand({
  description:
    'Release a bundle to a channel, uploading the web build first unless --bundle names one, and wait until it is live.',
  examples: [
    'hotcodepush release create --path dist',
    'hotcodepush release create --bundle 17 --channel staging --rollout-percentage 10 --notes "cart fix" --yes',
  ],
  options: defineCommandOptions({
    ...bundleUploadOptionShape,
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
        "The channel, by id or name, repeatable; hotcodepush.json's channelId by default.",
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
    const bundle = await resolveBundleToRelease(hotCodePush, options);
    const channels = await fetchChannels(hotCodePush, options);
    const rolloutPercentage = options.rolloutPercentage ?? 100;
    const isConfirmed = await confirmConsequence(
      resolveReleaseConsequence(
        bundle,
        channels,
        rolloutPercentage,
        options.mandatory ?? false,
      ),
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const releaseBody: ReleaseBody = {
      bundleId: bundle.id,
      isMandatory: options.mandatory ?? false,
      notes: options.notes ?? null,
      rolloutPercentage,
    };
    const releases: Release[] = [];
    for (const channel of channels) {
      const createdRelease = await hotCodePush.apps.channels.releases.create({
        ...releaseBody,
        appId: bundle.appId,
        channelId: channel.id,
        idempotencyKey: resolveIdempotencyKey(bundle, channel, releaseBody),
      });
      const liveRelease = await waitUntilLive(hotCodePush, createdRelease);
      releases.push(liveRelease);
      if (!options.json) {
        printReleasedLine(
          liveRelease,
          channel.name,
          resolveBundleLabel(bundle),
        );
      }
    }
    if (options.json) {
      printJson(releases.length === 1 ? releases[0] : releases);
    }
  },
});

/**
 * What the release does, with the audience: every channel's active devices, at the rollout percentage the share of them.
 */
export function resolveReleaseConsequence(
  bundle: Bundle,
  channels: ChannelWithDeviceCounts[],
  rolloutPercentage: number,
  isMandatory: boolean,
): string {
  const reaches = channels
    .map(
      ({ activeDeviceCount, name }) =>
        `${resolveReachText(activeDeviceCount, rolloutPercentage)} in ${name}`,
    )
    .join(' and ');
  return `releases bundle ${resolveBundleLabel(bundle)} at ${rolloutPercentage} percent${isMandatory ? ', mandatory' : ''}: reaches ${reaches}`;
}

function resolveReachText(
  activeDeviceCount: number,
  rolloutPercentage: number,
): string {
  const deviceText = `${activeDeviceCount.toLocaleString('en-US')} devices`;
  if (rolloutPercentage === 100) {
    return deviceText;
  }
  const reachedCount = Math.round(
    (activeDeviceCount * rolloutPercentage) / 100,
  );
  return `about ${reachedCount.toLocaleString('en-US')} of ${deviceText}`;
}

/**
 * Every channel `--channel` names, or the project's one when none is named.
 */
async function fetchChannels(
  hotCodePush: HotCodePush,
  options: ReleaseCreateOptions,
): Promise<ChannelWithDeviceCounts[]> {
  const channelNames =
    options.channel === undefined || options.channel.length === 0
      ? [undefined]
      : options.channel;
  return Promise.all(
    channelNames.map(channel =>
      fetchChannel(hotCodePush, { ...options, channel }),
    ),
  );
}

/**
 * `--bundle` names an uploaded bundle; otherwise the web build under `--path` is uploaded first, `bundle upload`'s way.
 */
async function resolveBundleToRelease(
  hotCodePush: HotCodePush,
  options: ReleaseCreateOptions,
): Promise<Bundle> {
  if (options.bundle === undefined) {
    const { bundle } = await uploadBundleFromOptions(hotCodePush, options);
    return bundle;
  }
  if (options.path !== undefined) {
    throw new InvalidParameterError(
      '--bundle and --path: pass one of them, the bundle to release or the build to upload',
      undefined,
    );
  }
  const appId = await fetchAppId(
    hotCodePush,
    options,
    readProjectConfig(options.config),
  );
  return fetchBundle(hotCodePush, appId, options);
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
