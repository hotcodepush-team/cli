export const DURATION_PATTERN = /^\d+[dh]$/;

const MILLISECONDS_PER_DURATION_UNIT = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
} as const;

// The caller has checked the duration against `DURATION_PATTERN`.
export function resolveDurationMilliseconds(duration: string): number {
  const unit = duration.slice(
    -1,
  ) as keyof typeof MILLISECONDS_PER_DURATION_UNIT;
  return Number(duration.slice(0, -1)) * MILLISECONDS_PER_DURATION_UNIT[unit];
}

// A duration such as 2h means that long ago. Anything else is passed on as a timestamp.
export function resolveTimeBound(
  bound: string | undefined,
): string | undefined {
  return bound !== undefined && DURATION_PATTERN.test(bound)
    ? new Date(Date.now() - resolveDurationMilliseconds(bound)).toISOString()
    : bound;
}
