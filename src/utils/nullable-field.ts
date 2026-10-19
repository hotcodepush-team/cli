import { InvalidParameterError } from './errors.js';

/**
 * A nullable field from the flag that sets it and the `--clear-` flag that sends null: the value, null when cleared,
 * left out when neither is passed; the two together are refused.
 */
export function resolveNullableField<TValue>(
  value: TValue | undefined,
  isCleared: boolean | undefined,
  flagName: string,
  clearFlagName = `clear-${flagName}`,
): TValue | null | undefined {
  if (!isCleared) {
    return value;
  }
  if (value !== undefined) {
    throw new InvalidParameterError(
      `The flags --${flagName} and --${clearFlagName} were passed together.`,
      'Pass only one of them.',
    );
  }
  return null;
}
