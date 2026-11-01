import type { FleetStatistics } from '@hotcodepush/node';

type BinaryBucket = FleetStatistics['binary'][number];

// The fleet counts only the devices seen in the last 30 days.
export const UNSEEN_IN_FLEET_WINDOW_TEXT = 'not in 30 days';

export function resolveBinaryBucket(
  fleet: FleetStatistics,
  binaryId: string,
): BinaryBucket | undefined {
  return fleet.binary.find(({ value }) => value === binaryId);
}

// A null release id stands for the embedded bundles.
export function resolveReleaseDeviceCount(
  fleet: FleetStatistics,
  releaseId: string | null,
): number {
  return (
    fleet.release.find(({ value }) => value === releaseId)?.deviceCount ?? 0
  );
}
