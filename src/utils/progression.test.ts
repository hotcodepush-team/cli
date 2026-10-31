import type { Release } from '@hotcodepush/node';
import { describe, expect, it } from 'vitest';
import { LIVE_RELEASE } from '../../test/fixtures.js';
import { RELEASE_COUNTERS } from '../../test/release-routes.js';
import { resolveProgressionStep } from './progression.js';

const SCHEDULE = {
  percentages: [10, 50, 100],
  stepMinimumSeconds: 3600,
  stepMinimumUpdateCount: 50,
};

const STEP_STARTED_AT = '2026-10-10T14:00:00.000Z';

// The first step started at 120 applied updates on the counters.
function buildProgressingRelease(
  appliedUpdateCount: number,
  fields: Partial<Release> = {},
): Release {
  return {
    ...LIVE_RELEASE,
    progression: SCHEDULE,
    progressionStepStartedAt: STEP_STARTED_AT,
    releaseCounters: { ...RELEASE_COUNTERS, appliedUpdateCount },
    rolloutPercentage: 10,
    stepStartAppliedUpdateCount: 120,
    ...fields,
  };
}

describe('resolveProgressionStep', () => {
  it('should answer null when the release has no schedule', () => {
    expect(
      resolveProgressionStep(buildProgressingRelease(0, { progression: null })),
    ).toBeNull();
  });

  it('should answer null while the release is paused', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(130, { status: 'paused' }),
      ),
    ).toBeNull();
  });

  it('should answer null while the release is revoked', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(130, { status: 'revoked' }),
      ),
    ).toBeNull();
  });

  it('should answer null once the rollout reached the last step', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(200, { rolloutPercentage: 100 }),
      ),
    ).toBeNull();
  });

  it('should wait on the sample with no applied updates when the step has not started', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(30, {
          progressionStepStartedAt: null,
          stepStartAppliedUpdateCount: 0,
        }),
      ),
    ).toEqual({
      gate: {
        appliedUpdateCount: 0,
        requiredUpdateCount: 50,
        type: 'sample',
      },
      number: 1,
    });
  });

  it("should wait on the sample while the step's applied updates since its start are short of it", () => {
    expect(resolveProgressionStep(buildProgressingRelease(169))).toEqual({
      gate: {
        appliedUpdateCount: 49,
        requiredUpdateCount: 50,
        type: 'sample',
      },
      number: 1,
    });
  });

  it("should wait on the step's minimum time once its applied updates reach the sample", () => {
    expect(resolveProgressionStep(buildProgressingRelease(170))).toEqual({
      gate: { readyAt: '2026-10-10T15:00:00.000Z', type: 'time' },
      number: 1,
    });
  });

  it('should gate the widening from a rollout below the first step', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(130, { rolloutPercentage: 5 }),
      ),
    ).toEqual({
      gate: {
        appliedUpdateCount: 10,
        requiredUpdateCount: 50,
        type: 'sample',
      },
      number: 0,
    });
  });

  it('should gate the widening to the last step', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(170, { rolloutPercentage: 50 }),
      ),
    ).toEqual({
      gate: { readyAt: '2026-10-10T15:00:00.000Z', type: 'time' },
      number: 2,
    });
  });

  it('should count the steps at or below a percentage set between them', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(132, { rolloutPercentage: 30 }),
      )?.number,
    ).toBe(1);
  });

  it('should count no applied update when the release was read without its counters', () => {
    expect(
      resolveProgressionStep(
        buildProgressingRelease(170, { releaseCounters: undefined }),
      ),
    ).toEqual({
      gate: {
        appliedUpdateCount: 0,
        requiredUpdateCount: 50,
        type: 'sample',
      },
      number: 1,
    });
  });
});
