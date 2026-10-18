import { describe, expect, it } from 'vitest';
import {
  LIVE_RELEASE,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
} from '../../test/fixtures.js';
import { resolveEffectiveFailurePolicy } from './channel-fields.js';

const OVERRIDING_RELEASE = {
  ...LIVE_RELEASE,
  failureAction: 'none',
  failureMinimumUpdateCount: 100,
  failureThresholdPercent: 3,
} as const;

describe('resolveEffectiveFailurePolicy', () => {
  it("should resolve the channel's own values when the channel sets every field", () => {
    expect(resolveEffectiveFailurePolicy(STAGING_CHANNEL)).toEqual({
      failureAction: { level: 'own', value: 'pause' },
      failureMinimumUpdateCount: { level: 'own', value: 20 },
      failureThresholdPercent: { level: 'own', value: 10 },
    });
  });

  it('should resolve the defaults when the channel sets no field', () => {
    expect(resolveEffectiveFailurePolicy(PRODUCTION_CHANNEL)).toEqual({
      failureAction: { level: 'default', value: 'pause' },
      failureMinimumUpdateCount: { level: 'default', value: 50 },
      failureThresholdPercent: { level: 'default', value: 5 },
    });
  });

  it("should resolve the release's own values before its channel's", () => {
    expect(
      resolveEffectiveFailurePolicy(OVERRIDING_RELEASE, STAGING_CHANNEL),
    ).toEqual({
      failureAction: { level: 'own', value: 'none' },
      failureMinimumUpdateCount: { level: 'own', value: 100 },
      failureThresholdPercent: { level: 'own', value: 3 },
    });
  });

  it("should resolve the channel's values when the release sets no field", () => {
    expect(
      resolveEffectiveFailurePolicy(LIVE_RELEASE, STAGING_CHANNEL),
    ).toEqual({
      failureAction: { level: 'channel', value: 'pause' },
      failureMinimumUpdateCount: { level: 'channel', value: 20 },
      failureThresholdPercent: { level: 'channel', value: 10 },
    });
  });

  it('should resolve the defaults when neither the release nor its channel sets a field', () => {
    expect(
      resolveEffectiveFailurePolicy(LIVE_RELEASE, PRODUCTION_CHANNEL),
    ).toEqual({
      failureAction: { level: 'default', value: 'pause' },
      failureMinimumUpdateCount: { level: 'default', value: 50 },
      failureThresholdPercent: { level: 'default', value: 5 },
    });
  });

  it('should resolve each field from the first level that sets it', () => {
    expect(
      resolveEffectiveFailurePolicy(
        { ...LIVE_RELEASE, failureAction: 'none' },
        { ...PRODUCTION_CHANNEL, failureThresholdPercent: 10 },
      ),
    ).toEqual({
      failureAction: { level: 'own', value: 'none' },
      failureMinimumUpdateCount: { level: 'default', value: 50 },
      failureThresholdPercent: { level: 'channel', value: 10 },
    });
  });
});
