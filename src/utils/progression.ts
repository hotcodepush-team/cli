import type { Release } from '@hotcodepush/node';
import { z } from 'zod';
import { InvalidParameterError } from './errors.js';

export type Progression = NonNullable<Release['progression']>;

// The next step waits for enough applied updates first, then for its minimum time.
type ProgressionGate =
  | {
      appliedUpdateCount: number;
      requiredUpdateCount: number;
      type: 'sample';
    }
  | { readyAt: string; type: 'time' };

export interface ProgressionOptions {
  progression?: boolean;
  progressionMinimumSeconds?: number;
  progressionMinimumUpdateCount?: number;
  progressionPercentages?: number[];
}

interface ProgressionStep {
  gate: ProgressionGate;
  number: number;
}

const DEFAULT_PROGRESSION: Progression = {
  percentages: [10, 50, 100],
  stepMinimumSeconds: 3600,
  stepMinimumUpdateCount: 50,
};

// Parses `10,50,100` in the schema, so a wrong percentage is reported under the flag name.
const percentageListSchema = z
  .string()
  .transform(value => value.split(',').map(percentage => percentage.trim()))
  .pipe(z.array(z.coerce.number<string>().int()));

// The API validates the schedule itself.
export const progressionShape = {
  progression: z
    .boolean()
    .optional()
    .describe(
      'Widen the rollout step by step while the release stays healthy: 10, 50 and 100 percent by default, each step after at least an hour and 50 applied updates.',
    ),
  progressionMinimumSeconds: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The seconds a step lasts at least before the next one, with --progression; 3600 by default.',
    ),
  progressionMinimumUpdateCount: z.coerce
    .number()
    .int()
    .optional()
    .describe(
      'The applied updates each step needs before the next one, with --progression; 50 by default.',
    ),
  progressionPercentages: percentageListSchema
    .optional()
    .describe(
      'The percentages the rollout widens through, rising, the last above the starting rollout, with --progression; 10,50,100 by default.',
    ),
};

// A schedule flag without `--progression` is refused rather than taken as one.
export function resolveProgression(
  options: ProgressionOptions,
): Progression | null {
  if (!options.progression) {
    assertNoProgressionFlags(options);
    return null;
  }
  return {
    percentages:
      options.progressionPercentages ?? DEFAULT_PROGRESSION.percentages,
    stepMinimumSeconds:
      options.progressionMinimumSeconds ??
      DEFAULT_PROGRESSION.stepMinimumSeconds,
    stepMinimumUpdateCount:
      options.progressionMinimumUpdateCount ??
      DEFAULT_PROGRESSION.stepMinimumUpdateCount,
  };
}

// Mirrors how the progression job of the API reads the release.
// Nothing widens a paused or revoked release, so it has no step.
export function resolveProgressionStep(
  release: Release,
): ProgressionStep | null {
  const { progression, progressionStepStartedAt, releaseCounters } = release;
  if (progression === null || release.status !== 'active') {
    return null;
  }
  const number = progression.percentages.filter(
    percentage => percentage <= release.rolloutPercentage,
  ).length;
  if (number === progression.percentages.length) {
    return null;
  }
  const appliedUpdateCount =
    progressionStepStartedAt === null || releaseCounters === undefined
      ? 0
      : releaseCounters.appliedUpdateCount -
        release.stepStartAppliedUpdateCount;
  if (
    progressionStepStartedAt === null ||
    appliedUpdateCount < progression.stepMinimumUpdateCount
  ) {
    return {
      gate: {
        appliedUpdateCount,
        requiredUpdateCount: progression.stepMinimumUpdateCount,
        type: 'sample',
      },
      number,
    };
  }
  return {
    gate: {
      readyAt: new Date(
        Date.parse(progressionStepStartedAt) +
          progression.stepMinimumSeconds * 1000,
      ).toISOString(),
      type: 'time',
    },
    number,
  };
}

export function resolveProgressionStepText(
  release: Release,
  progression: Progression,
): string {
  const progressionStep = resolveProgressionStep(release);
  if (progressionStep !== null) {
    return `${progressionStep.number} of ${progression.percentages.length}, ${resolveGateText(progressionStep.gate)}`;
  }
  switch (release.status) {
    case 'active':
      return 'complete';
    case 'paused':
      return 'held while paused';
    case 'revoked':
      return 'ended by the revocation';
  }
}

export function resolveProgressionText({
  percentages,
  stepMinimumSeconds,
  stepMinimumUpdateCount,
}: Progression): string {
  return `${percentages.join(', ')} percent, each step at least ${stepMinimumSeconds} seconds and ${stepMinimumUpdateCount} applied updates`;
}

function assertNoProgressionFlags(options: ProgressionOptions): void {
  const progressionFlags = [
    options.progressionMinimumSeconds === undefined
      ? undefined
      : '--progression-minimum-seconds',
    options.progressionMinimumUpdateCount === undefined
      ? undefined
      : '--progression-minimum-update-count',
    options.progressionPercentages === undefined
      ? undefined
      : '--progression-percentages',
  ].filter(flag => flag !== undefined);
  if (progressionFlags.length > 0) {
    throw new InvalidParameterError(
      `The schedule's flags ${progressionFlags.join(' and ')} apply only with --progression.`,
      'Pass --progression to give the release a schedule.',
    );
  }
}

function resolveGateText(gate: ProgressionGate): string {
  return gate.type === 'sample'
    ? `Waiting on updates: ${gate.appliedUpdateCount} of ${gate.requiredUpdateCount} applied`
    : `ready at ${gate.readyAt}`;
}
