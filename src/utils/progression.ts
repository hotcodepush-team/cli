import type { Release } from '@hotcodepush/node';
import { z } from 'zod';
import { InvalidParameterError } from './errors.js';

/**
 * The schedule `--progress` gives a release: the percentages it widens through and the minimum time and sample of each step.
 */
export type Progression = NonNullable<Release['progression']>;

type ProgressionGate = NonNullable<Release['progressionStep']>['gate'];

export interface ProgressionOptions {
  progress?: boolean;
  progressMinimumSample?: number;
  progressMinimumSeconds?: number;
  progressPercentages?: number[];
}

const DEFAULT_PROGRESSION: Progression = {
  minimumSample: 50,
  minimumSeconds: 3600,
  percentages: [10, 50, 100],
};

// `10,50,100` as typed, each percentage checked in the schema so a wrong one is answered under the flag's name
const percentageListSchema = z
  .string()
  .transform(value => value.split(',').map(percentage => percentage.trim()))
  .pipe(z.array(z.coerce.number<string>().int()));

/**
 * The flags of the schedule `release create` and `release rollout` give a release; the API checks the schedule itself.
 */
export const progressionShape = {
  progress: z
    .boolean()
    .optional()
    .describe(
      'Widen the rollout step by step while the release stays healthy: 10, 50 and 100 percent by default, each step after at least an hour and 50 update attempts.',
    ),
  progressMinimumSample: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The update attempts a step waits for before the next one, with --progress; 50 by default.',
    ),
  progressMinimumSeconds: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The seconds a step lasts at least before the next one, with --progress; 3600 by default.',
    ),
  progressPercentages: percentageListSchema
    .optional()
    .describe(
      'The percentages the rollout widens through, rising, the last above the starting rollout, with --progress; 10,50,100 by default.',
    ),
};

/**
 * The schedule from its flags, the defaults filling what is left out, or null without `--progress`;
 * a schedule's flag without the switch is refused rather than taken as one.
 */
export function resolveProgression(
  options: ProgressionOptions,
): Progression | null {
  if (!options.progress) {
    assertNoProgressionFlags(options);
    return null;
  }
  return {
    minimumSample:
      options.progressMinimumSample ?? DEFAULT_PROGRESSION.minimumSample,
    minimumSeconds:
      options.progressMinimumSeconds ?? DEFAULT_PROGRESSION.minimumSeconds,
    percentages: options.progressPercentages ?? DEFAULT_PROGRESSION.percentages,
  };
}

/**
 * Where a release stands in its schedule: the step reached of all of them and the gate the next widening waits on,
 * `1 of 3, waiting on sample: 12 of 50 attempts`; nothing widens a complete, paused or revoked one, so it has no step.
 */
export function resolveProgressionStepText(
  { progressionStep, state }: Release,
  progression: Progression,
): string {
  if (progressionStep !== null) {
    return `${progressionStep.number} of ${progression.percentages.length}, ${resolveGateText(progressionStep.gate)}`;
  }
  switch (state) {
    case 'active':
      return 'complete';
    case 'paused':
      return 'held while paused';
    case 'revoked':
      return 'ended by the revocation';
  }
}

/**
 * The schedule as a confirmation states it: `10, 50, 100 percent, each step at least 3600 seconds and 50 attempts`.
 */
export function resolveProgressionText({
  minimumSample,
  minimumSeconds,
  percentages,
}: Progression): string {
  return `${percentages.join(', ')} percent, each step at least ${minimumSeconds} seconds and ${minimumSample} attempts`;
}

function assertNoProgressionFlags(options: ProgressionOptions): void {
  const progressionFlags = [
    options.progressMinimumSample === undefined
      ? undefined
      : '--progress-minimum-sample',
    options.progressMinimumSeconds === undefined
      ? undefined
      : '--progress-minimum-seconds',
    options.progressPercentages === undefined
      ? undefined
      : '--progress-percentages',
  ].filter(flag => flag !== undefined);
  if (progressionFlags.length > 0) {
    throw new InvalidParameterError(
      `${progressionFlags.join(' and ')}: a schedule's flags apply only with --progress`,
      undefined,
      'pass --progress to give the release a schedule.',
    );
  }
}

function resolveGateText(gate: ProgressionGate): string {
  return gate.kind === 'sample'
    ? `waiting on sample: ${gate.attempted} of ${gate.required} attempts`
    : `ready at ${gate.readyAt}`;
}
