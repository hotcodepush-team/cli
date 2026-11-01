import type { Release } from '@hotcodepush/node';
import { z } from 'zod';
import { channelOptionShape } from '../../resources/channels/fetch.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../resources/releases/fetch.js';
import { resolveProgressingText } from '../../resources/releases/output.js';
import type { Progression } from '../../resources/releases/progression.js';
import {
  progressionShape,
  resolveProgression,
  resolveProgressionText,
} from '../../resources/releases/progression.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence, promptText } from '../../utils/prompts.js';

const rolloutPercentSchema = z.coerce.number().int().min(0).max(100);

export default defineCommand({
  description:
    "Set a release's rollout percentage in either direction, or widen it step by step with --progression. A device that has the release keeps it.",
  examples: [
    'hotcodepush release rollout --release 43 --rollout-percent 50',
    'hotcodepush release rollout --channel staging --release 43 --rollout-percent 10 --progression --yes',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...progressionShape,
    ...releaseOptionShape,
    rolloutPercent: rolloutPercentSchema
      .optional()
      .describe(
        "The share of devices the release reaches from now on, 0 to 100. With --progression it is where the schedule starts. Defaults to the release's own percentage.",
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const progression = resolveProgression(options);
    const rolloutPercent =
      options.rolloutPercent ??
      (progression === null ? await promptRolloutPercent(options) : undefined);
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      resolveRolloutConsequence(
        release,
        channel.name,
        rolloutPercent ?? release.rolloutPercent,
        progression,
      ),
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const updatedRelease = await hotCodePush.apps.releases.update({
      appId: channel.appId,
      progression: progression ?? undefined,
      releaseId: release.id,
      rolloutPercent,
    });
    if (options.json) {
      printJson(updatedRelease);
    } else {
      console.log(
        `Set release #${updatedRelease.number} of ${channel.name} to ${updatedRelease.rolloutPercent} percent${resolveProgressingText(updatedRelease)}.`,
      );
    }
  },
});

async function promptRolloutPercent(
  options: InteractivityOptions,
): Promise<number> {
  const answer = await promptText(options, {
    flag: '--rollout-percent',
    message: 'Which share of devices should the release reach, 0 to 100?',
  });
  return z
    .object({ rolloutPercent: rolloutPercentSchema })
    .parse({ rolloutPercent: answer }).rolloutPercent;
}

function resolveRolloutConsequence(
  release: Release,
  channelName: string,
  rolloutPercent: number,
  progression: Progression | null,
): string {
  const releaseText = `release #${release.number} of ${channelName}`;
  if (progression !== null) {
    return `progresses ${releaseText} from ${rolloutPercent} percent through ${resolveProgressionText(progression)}: devices already on it keep it`;
  }
  const progressionEndText =
    release.progression === null ? '' : ', and its progression ends';
  return `sets ${releaseText} to ${rolloutPercent} percent: devices already on it keep it, and no new device above ${rolloutPercent} percent gets it${progressionEndText}`;
}
