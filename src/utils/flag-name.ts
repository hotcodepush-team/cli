// Matches how zodline maps a schema key to a flag: `rolloutPercent` becomes `rollout-percent`.
export function resolveFlagName(key: string): string {
  return key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}
