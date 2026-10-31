import type { Audience } from '@hotcodepush/node';

export function resolveAudienceText(
  audience: Audience,
  channelName: string,
  rolloutPercentage: number,
): string {
  const reachText = `reaches ${resolveCountText(audience.reachedDeviceCount)} of ${resolveCountText(audience.deviceCount)} active devices in ${channelName}`;
  return rolloutPercentage === 100
    ? reachText
    : `${reachText}; about ${resolveCountText(audience.estimatedDeviceCount)} at a ${rolloutPercentage} percent rollout`;
}

function resolveCountText(count: number): string {
  return count.toLocaleString('en-US');
}
