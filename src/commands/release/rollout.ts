import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      `sets release #${release.number} of ${channel.name} to ${options.rolloutPercentage} percent: devices already on it keep it, and no new device above ${options.rolloutPercentage} percent gets it`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const updatedRelease = await hotCodePush.apps.releases.update({
      appId: release.appId,
      releaseId: release.id,
      rolloutPercentage: options.rolloutPercentage,
    });
    if (options.json) {
      printJson(updatedRelease);
    } else {
      console.log(
        `Set release #${updatedRelease.number} of ${channel.name} to ${updatedRelease.rolloutPercentage} percent.`,
      );
    }
  },
  description:
    "Set a release's rollout percentage in either direction; a device that has the release keeps it.",
  examples: [
    'hotcodepush release rollout --release 43 --rollout-percentage 50',
    'hotcodepush release rollout --channel staging --release 43 --rollout-percentage 0 --yes',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
    rolloutPercentage: z.coerce
      .number()
      .int()
      .min(0)
      .max(100)
      .describe(
        'The share of devices the release reaches from now on, 0 to 100.',
      ),
  }),
});
