import { describe, expect, it } from 'vitest';
import { resolveNullableField } from './nullable-field.js';

describe('resolveNullableField', () => {
  it('should return the value when the field is not cleared', () => {
    expect(
      resolveNullableField('cart fix', {
        flagName: 'notes',
        isCleared: undefined,
      }),
    ).toBe('cart fix');
  });

  it('should return null when the field is cleared', () => {
    expect(
      resolveNullableField(undefined, { flagName: 'notes', isCleared: true }),
    ).toBeNull();
  });

  it('should leave the field out when neither flag is passed', () => {
    expect(
      resolveNullableField(undefined, { flagName: 'notes', isCleared: false }),
    ).toBeUndefined();
  });

  it('should refuse the value together with the clear flag', () => {
    expect(() =>
      resolveNullableField('cart fix', { flagName: 'notes', isCleared: true }),
    ).toThrow(
      expect.objectContaining({
        code: 'invalid_parameter',
        fix: 'Pass only one of them.',
        message: 'The flags --notes and --clear-notes were passed together.',
      }),
    );
  });
});
