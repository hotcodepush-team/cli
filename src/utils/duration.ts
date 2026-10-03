export const DURATION_PATTERN = /^\d+[dh]$/;

const MILLISECONDS_PER_DURATION_UNIT = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
} as const;

/**
 * A duration such as 14d or 12h in milliseconds; the caller checked it against `DURATION_PATTERN`.
 */
export function resolveDurationMilliseconds(duration: string): number {
  const unit = duration.slice(
    -1,
  ) as keyof typeof MILLISECONDS_PER_DURATION_UNIT;
  return Number(duration.slice(0, -1)) * MILLISECONDS_PER_DURATION_UNIT[unit];
}

/**
 * A time bound as the API takes it: a duration such as 2h is that long ago, anything else a timestamp passed on as typed.
 */
export function resolveTimeBound(
  bound: string | undefined,
): string | undefined {
  return bound !== undefined && DURATION_PATTERN.test(bound)
    ? new Date(Date.now() - resolveDurationMilliseconds(bound)).toISOString()
    : bound;
}
