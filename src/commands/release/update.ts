import type { UpdateReleaseOptions } from '@hotcodepush/node';
import { z } from 'zod';
import { channelOptionShape } from '../../resources/channels/fetch.js';
import type { FailurePolicyOptions } from '../../resources/channels/fields.js';
import {
  failurePolicyShape,
  releaseFailurePolicyClearShape,
  resolveFailurePolicy,
} from '../../resources/channels/fields.js';
import {
  fetchReleaseInChannel,
  releaseOptionShape,
} from '../../resources/releases/fetch.js';
import { createApiClient } from '../../utils/api-client.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import { defineCommand } from '../../utils/command.js';
import { MissingParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveNullableField } from '../../utils/nullable-field.js';
import { printJson, printResult } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

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
        'Whether devices apply the release at once and restart. Pass false to turn it off.',
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
        { fix: 'Pass at least one of them.' },
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
      printResult({
        rows: [['ID', updatedRelease.id]],
        sentence: `Updated release #${updatedRelease.number} of ${channel.name}.`,
      });
    }
  },
});

// Uses the field order of `release get`.
function resolveChangeTexts(changes: ReleaseChanges): string[] {
  return [
    resolveFailureThresholdText(changes.failureThresholdPercent),
    resolveFailureMinimumUpdateCountText(changes.failureMinimumUpdateCount),
    resolveFailureActionText(changes.failureAction),
    resolveMandatoryText(changes.isMandatory),
    resolveNotesText(changes.notes),
  ].filter(changeText => changeText !== undefined);
}

function resolveFailureActionText(
  failureAction: ReleaseChanges['failureAction'],
): string | undefined {
  return failureAction === undefined
    ? undefined
    : `failure action ${failureAction ?? CLEARED_TEXT}`;
}

function resolveFailureMinimumUpdateCountText(
  failureMinimumUpdateCount: ReleaseChanges['failureMinimumUpdateCount'],
): string | undefined {
  return failureMinimumUpdateCount === undefined
    ? undefined
    : `failure minimum update count ${failureMinimumUpdateCount ?? CLEARED_TEXT}`;
}

function resolveFailureThresholdText(
  failureThresholdPercent: ReleaseChanges['failureThresholdPercent'],
): string | undefined {
  if (failureThresholdPercent === undefined) {
    return undefined;
  }
  return `failure threshold ${failureThresholdPercent === null ? CLEARED_TEXT : `${failureThresholdPercent}%`}`;
}

function resolveMandatoryText(
  isMandatory: ReleaseChanges['isMandatory'],
): string | undefined {
  if (isMandatory === undefined) {
    return undefined;
  }
  return `mandatory ${isMandatory ? 'on' : 'off'}`;
}

function resolveNotesText(notes: ReleaseChanges['notes']): string | undefined {
  if (notes === undefined) {
    return undefined;
  }
  return notes === null ? `notes ${CLEARED_TEXT}` : `notes "${notes}"`;
}

function resolveReleaseChanges(options: ReleaseUpdateOptions): ReleaseChanges {
  return {
    ...resolveFailurePolicy(options),
    isMandatory: options.mandatory,
    notes: resolveNullableField(options.notes, {
      flagName: 'notes',
      isCleared: options.clearNotes,
    }),
  };
}
