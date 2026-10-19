import type { FleetStatistics } from '@hotcodepush/node';

type BinaryBucket = FleetStatistics['binary'][number];

/**
 * A binary's last sighting without a bucket: the fleet counts only the devices seen in the last thirty days.
 */
export const UNSEEN_IN_FLEET_WINDOW_TEXT = 'not in 30 days';

/**
 * The fleet's bucket of a binary, its devices and their newest report; none when no device seen in the last thirty days runs it.
 */
export function resolveBinaryBucket(
  fleet: FleetStatistics,
  binaryId: string,
): BinaryBucket | undefined {
  return fleet.binary.find(({ value }) => value === binaryId);
}

/**
 * The devices the fleet counts on a release, `null` naming the embedded bundles; 0 when no bucket carries it.
 */
export function resolveReleaseDeviceCount(
  fleet: FleetStatistics,
  releaseId: string | null,
): number {
  return (
    fleet.release.find(({ value }) => value === releaseId)?.deviceCount ?? 0
  );
}
