import type { BundleWithDeltaPacks } from '@hotcodepush/node';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  bundleOptionShape,
  fetchBundle,
} from '../../utils/bundle-resolution.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printDetails,
  printJson,
  resolveQuantityText,
} from '../../utils/output.js';
import { resolveByteText } from '../../utils/progress.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

type DeltaPack = BundleWithDeltaPacks['deltaPacks'][number];

export default defineCommand({
  description: 'Print a bundle, by its number or id, with its delta packs.',
  examples: [
    'hotcodepush bundle get --bundle 17',
    'hotcodepush bundle get --bundle 17 --json',
  ],
  options: defineCommandOptions(bundleOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const fetchedBundle = await fetchBundle(hotCodePush, appId, options);
    if (options.json) {
      printJson(fetchedBundle);
      return;
    }
    printDetails([
      ['ID', fetchedBundle.id],
      [
        'Number',
        fetchedBundle.number === null ? 'none' : `#${fetchedBundle.number}`,
      ],
      ['Type', fetchedBundle.type],
      ['Version', fetchedBundle.version],
      ['State', fetchedBundle.state],
      ['Platforms', fetchedBundle.platforms.join(', ')],
      ['Size', resolveByteText(fetchedBundle.sizeBytes)],
      ['Delta packs', resolveDeltaPacksText(fetchedBundle.deltaPacks)],
      ['Fingerprint', fetchedBundle.fingerprint ?? 'none'],
      ['Commit', fetchedBundle.gitSha ?? 'unknown'],
      ['Expires', fetchedBundle.expiresAt ?? 'in use'],
      ['Created', fetchedBundle.createdAt],
    ]);
  },
});

/**
 * The delta packs on one line, each by its base's number, `embedded` for a binary's bundle: `#16: 48.2 kB, 2 patches, built`,
 * a pack without a build, requested or failed, by its state alone.
 */
function resolveDeltaPacksText(deltaPacks: DeltaPack[]): string {
  if (deltaPacks.length === 0) {
    return 'none';
  }
  return deltaPacks.map(resolveDeltaPackText).join('; ');
}

function resolveDeltaPackText({
  baseBundleNumber,
  patchCount,
  sizeBytes,
  state,
}: DeltaPack): string {
  const baseText =
    baseBundleNumber === null ? 'embedded' : `#${baseBundleNumber}`;
  if (patchCount === null || sizeBytes === null) {
    return `${baseText}: ${state}`;
  }
  return `${baseText}: ${resolveByteText(sizeBytes)}, ${resolveQuantityText(patchCount, 'patch', 'patches')}, ${state}`;
}
