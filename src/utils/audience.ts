import type { Audience } from '@hotcodepush/node';

/**
 * The audience in one clause: `reaches 9,995 of 10,000 active devices in production; about 500 at a 5 percent rollout`.
 */
export function resolveAudienceText(
  audience: Audience,
  channelName: string,
  rolloutPercentage: number,
): string {
  const reachText = `reaches ${resolveCountText(audience.reached)} of ${resolveCountText(audience.total)} active devices in ${channelName}`;
  return rolloutPercentage === 100
    ? reachText
    : `${reachText}; about ${resolveCountText(audience.estimatedAtRollout)} at a ${rolloutPercentage} percent rollout`;
}

function resolveCountText(count: number): string {
  return count.toLocaleString('en-US');
}
