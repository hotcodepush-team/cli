import type { Device } from '@hotcodepush/node';

export function resolveBinaryText({
  binaryBuild,
  binaryVersion,
}: Pick<Device, 'binaryBuild' | 'binaryVersion'>): string {
  return `${binaryVersion} (${binaryBuild})`;
}
