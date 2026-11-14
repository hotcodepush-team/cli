import { InvalidParameterError } from './errors.js';

export function assertNoSurplusArguments(
  args: string[],
  { maximum, usage }: { maximum: number; usage: string },
): void {
  const surplusArguments = args.slice(maximum);
  if (surplusArguments.length > 0) {
    throw new InvalidParameterError(
      `${usage} It does not take ${surplusArguments.join(' ')}.`,
    );
  }
}
