import { InvalidParameterError } from './errors.js';

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
