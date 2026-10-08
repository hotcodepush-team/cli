import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import { MissingParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

interface ReleaseChanges {
  mandatory?: boolean;
  notes?: string;
}

export default defineCommand({
  description:
    'Edit a published release in place: flip the mandatory flag or rewrite the notes.',
  examples: [
    'hotcodepush release update --release 43 --mandatory',
    'hotcodepush release update --channel staging --release 43 --mandatory false --notes "cart fix" --yes',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...releaseOptionShape,
    mandatory: booleanFlagSchema
      .optional()
      .describe(
        'Whether devices apply the release at once and restart; pass false to clear it.',
      ),
    notes: z.string().optional().describe('The new release notes.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const changes = resolveChangeTexts(options);
    if (changes.length === 0) {
      throw new MissingParameterError('--mandatory or --notes');
    }
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      `changes release #${release.number} of ${channel.name}, ${changes.join(' and ')}: devices see the change on their next check`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const updatedRelease = await hotCodePush.apps.releases.update({
      appId: release.appId,
      isMandatory: options.mandatory,
      notes: options.notes,
      releaseId: release.id,
    });
    if (options.json) {
      printJson(updatedRelease);
    } else {
      console.log(
        `Updated release #${updatedRelease.number} of ${channel.name} (${updatedRelease.id}).`,
      );
    }
  },
});

function resolveChangeTexts({ mandatory, notes }: ReleaseChanges): string[] {
  const changeTexts: string[] = [];
  if (mandatory !== undefined) {
    changeTexts.push(`mandatory ${mandatory ? 'on' : 'off'}`);
  }
  if (notes !== undefined) {
    changeTexts.push(`notes "${notes}"`);
  }
  return changeTexts;
}
