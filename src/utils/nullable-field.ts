import { InvalidParameterError } from './errors.js';

export function resolveNullableField<TValue>(
  value: TValue | undefined,
  {
    clearFlagName,
    flagName,
    isCleared,
  }: {
    clearFlagName?: string;
    flagName: string;
    isCleared: boolean | undefined;
  },
): TValue | null | undefined {
  if (!isCleared) {
    return value;
  }
  if (value !== undefined) {
    throw new InvalidParameterError(
      `The flags --${flagName} and --${clearFlagName ?? `clear-${flagName}`} were passed together.`,
      { fix: 'Pass only one of them.' },
    );
  }
  return null;
}
