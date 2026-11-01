import type { Audience } from '@hotcodepush/node';

export function resolveAudienceText(
  audience: Audience,
  channelName: string,
  rolloutPercent: number,
): string {
  const reachText = `reaches ${resolveCountText(audience.reachedDeviceCount)} of ${resolveCountText(audience.deviceCount)} active devices in ${channelName}`;
  return rolloutPercent === 100
    ? reachText
    : `${reachText}, about ${resolveCountText(audience.estimatedDeviceCount)} at a ${rolloutPercent} percent rollout`;
}

function resolveCountText(count: number): string {
  return count.toLocaleString('en-US');
}
