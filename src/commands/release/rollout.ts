import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence, promptText } from '../../utils/prompts.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

const rolloutPercentageSchema = z.coerce.number().int().min(0).max(100);

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const rolloutPercentage =
      options.rolloutPercentage ?? (await promptRolloutPercentage(options));
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      `sets release #${release.number} of ${channel.name} to ${rolloutPercentage} percent: devices already on it keep it, and no new device above ${rolloutPercentage} percent gets it`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const updatedRelease = await hotCodePush.apps.releases.update({
      appId: release.appId,
      releaseId: release.id,
      rolloutPercentage,
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
    rolloutPercentage: rolloutPercentageSchema
      .optional()
      .describe(
        'The share of devices the release reaches from now on, 0 to 100.',
      ),
  }),
});

/**
 * The percentage asked for when the flag is missing and someone can answer, checked as the flag would be.
 */
async function promptRolloutPercentage(
  options: InteractivityOptions,
): Promise<number> {
  const answer = await promptText(
    '--rollout-percentage',
    'Which share of devices should the release reach, 0 to 100?',
    options,
  );
  return z
    .object({ rolloutPercentage: rolloutPercentageSchema })
    .parse({ rolloutPercentage: answer }).rolloutPercentage;
}
