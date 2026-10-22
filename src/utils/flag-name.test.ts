import { describe, expect, it } from 'vitest';
import { resolveFlagName } from './flag-name.js';

describe('resolveFlagName', () => {
  it('should turn each capital letter into a hyphen and its lowercase', () => {
    expect(resolveFlagName('failureMinimumUpdateCount')).toBe(
      'failure-minimum-update-count',
    );
  });

  it('should keep a key without capital letters as it is', () => {
    expect(resolveFlagName('channel')).toBe('channel');
  });
});
