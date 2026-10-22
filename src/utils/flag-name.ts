/**
 * The flag name zodline matches to a schema key: each capital letter becomes a hyphen and its lowercase, `rolloutPercentage` `rollout-percentage`.
 */
export function resolveFlagName(key: string): string {
  return key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}
