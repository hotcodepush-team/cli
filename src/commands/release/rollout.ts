import type { Release } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import type { Progression } from '../../utils/progression.js';
import {
  progressionShape,
  resolveProgression,
  resolveProgressionText,
} from '../../utils/progression.js';
import { confirmConsequence, promptText } from '../../utils/prompts.js';
import { resolveProgressingText } from '../../utils/release-output.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

const rolloutPercentageSchema = z.coerce.number().int().min(0).max(100);

export default defineCommand({
  description:
    "Set a release's rollout percentage in either direction, or widen it step by step with --progress; a device that has the release keeps it.",
  examples: [
    'hotcodepush release rollout --release 43 --rollout-percentage 50',
    'hotcodepush release rollout --channel staging --release 43 --rollout-percentage 10 --progress --yes',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...progressionShape,
    ...releaseOptionShape,
    rolloutPercentage: rolloutPercentageSchema
      .optional()
      .describe(
        "The share of devices the release reaches from now on, 0 to 100; with --progress where the schedule starts, the release's own percentage by default.",
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const progression = resolveProgression(options);
    const rolloutPercentage =
      options.rolloutPercentage ??
      (progression === null
        ? await promptRolloutPercentage(options)
        : undefined);
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      resolveRolloutConsequence(
        release,
        channel.name,
        rolloutPercentage ?? release.rolloutPercentage,
        progression,
      ),
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const updatedRelease = await hotCodePush.apps.releases.update({
      appId: release.appId,
      progression: progression ?? undefined,
      releaseId: release.id,
      rolloutPercentage,
    });
    if (options.json) {
      printJson(updatedRelease);
    } else {
      console.log(
        `Set release #${updatedRelease.number} of ${channel.name} to ${updatedRelease.rolloutPercentage} percent${resolveProgressingText(updatedRelease)}.`,
      );
    }
  },
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

/**
 * What the rollout does: the schedule it starts from the percentage, or the percentage set by hand, which ends a schedule the release had.
 */
function resolveRolloutConsequence(
  release: Release,
  channelName: string,
  rolloutPercentage: number,
  progression: Progression | null,
): string {
  const releaseText = `release #${release.number} of ${channelName}`;
  if (progression !== null) {
    return `progresses ${releaseText} from ${rolloutPercentage} percent through ${resolveProgressionText(progression)}: devices already on it keep it`;
  }
  const progressionEndText =
    release.progression === null ? '' : '; its progression ends';
  return `sets ${releaseText} to ${rolloutPercentage} percent: devices already on it keep it, and no new device above ${rolloutPercentage} percent gets it${progressionEndText}`;
}
