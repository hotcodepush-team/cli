import type { UpdateReleaseOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import type { FailurePolicyOptions } from '../../utils/channel-fields.js';
import {
  failurePolicyShape,
  releaseFailurePolicyClearShape,
  resolveFailurePolicy,
} from '../../utils/channel-fields.js';
import { MissingParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveNullableField } from '../../utils/nullable-field.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../utils/release-resolution.js';
import { channelOptionShape } from '../../utils/resource-resolution.js';

type ReleaseChanges = Pick<
  UpdateReleaseOptions,
  | 'failureAction'
  | 'failureMinimumUpdateCount'
  | 'failureThresholdPercent'
  | 'isMandatory'
  | 'notes'
>;

interface ReleaseUpdateOptions extends FailurePolicyOptions {
  clearNotes?: boolean;
  mandatory?: boolean;
  notes?: string;
}

const CLEARED_TEXT = 'cleared';

export default defineCommand({
  description:
    'Edit a published release in place: flip the mandatory flag, rewrite or clear the notes, change or clear an auto-pause override.',
  examples: [
    'hotcodepush release update --release 43 --mandatory',
    'hotcodepush release update --channel staging --release 43 --mandatory false --notes "cart fix" --yes',
  ],
  options: defineCommandOptions({
    ...channelOptionShape,
    ...failurePolicyShape,
    ...releaseFailurePolicyClearShape,
    ...releaseOptionShape,
    clearNotes: z.boolean().optional().describe('Sets the notes back to null.'),
    mandatory: booleanFlagSchema
      .optional()
      .describe(
        'Whether devices apply the release at once and restart; pass false to turn it off.',
      ),
    notes: z.string().optional().describe('The new release notes.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const changes = resolveReleaseChanges(options);
    const changeTexts = resolveChangeTexts(changes);
    if (changeTexts.length === 0) {
      throw new MissingParameterError(
        '--mandatory, --notes, a --failure-* flag or a --clear-* flag',
        'Pass at least one of them.',
      );
    }
    const { channel, release } = await fetchReleaseInChannel(
      hotCodePush,
      options,
    );
    const isConfirmed = await confirmConsequence(
      `changes release #${release.number} of ${channel.name}, ${changeTexts.join(' and ')}: devices see the change on their next check`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const updatedRelease = await hotCodePush.apps.releases.update({
      ...changes,
      appId: channel.appId,
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

/**
 * What the confirmation says changes, in the order `release get` prints the fields, a field sent as null as cleared.
 */
function resolveChangeTexts({
  failureAction,
  failureMinimumUpdateCount,
  failureThresholdPercent,
  isMandatory,
  notes,
}: ReleaseChanges): string[] {
  const changeTexts: string[] = [];
  if (failureThresholdPercent !== undefined) {
    changeTexts.push(
      `failure threshold ${failureThresholdPercent === null ? CLEARED_TEXT : `${failureThresholdPercent}%`}`,
    );
  }
  if (failureMinimumUpdateCount !== undefined) {
    changeTexts.push(
      `failure minimum update count ${failureMinimumUpdateCount ?? CLEARED_TEXT}`,
    );
  }
  if (failureAction !== undefined) {
    changeTexts.push(`failure action ${failureAction ?? CLEARED_TEXT}`);
  }
  if (isMandatory !== undefined) {
    changeTexts.push(`mandatory ${isMandatory ? 'on' : 'off'}`);
  }
  if (notes !== undefined) {
    changeTexts.push(
      notes === null ? `notes ${CLEARED_TEXT}` : `notes "${notes}"`,
    );
  }
  return changeTexts;
}

/**
 * The API's body from the flags; a `--clear-` flag sends null, and a flag left out is a field left out.
 */
function resolveReleaseChanges(options: ReleaseUpdateOptions): ReleaseChanges {
  return {
    ...resolveFailurePolicy(options),
    isMandatory: options.mandatory,
    notes: resolveNullableField(options.notes, options.clearNotes, 'notes'),
  };
}
