import type { Binary } from '@hotcodepush/node';
import { resolveBundleLabel } from './bundles.js';

export function resolveBinaryBundleLabel(binary: Binary): string {
  return binary.bundle === undefined
    ? binary.bundleId
    : resolveBundleLabel(binary.bundle);
}
