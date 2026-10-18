import type { BundleDelta } from '@hotcodepush/node';
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
import { fetchAllPages } from '../../utils/pagination.js';
import { resolveByteText } from '../../utils/progress.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

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
    const fetchedDeltaPacks = await fetchAllPages(page =>
      hotCodePush.apps.bundles.deltas.list({
        ...page,
        appId,
        bundleId: fetchedBundle.id,
        relations: ['baseBundle'],
      }),
    );
    if (options.json) {
      printJson({ ...fetchedBundle, deltaPacks: fetchedDeltaPacks });
      return;
    }
    printDetails([
      ['ID', fetchedBundle.id],
      [
        'Number',
        fetchedBundle.number === null ? 'none' : `#${fetchedBundle.number}`,
      ],
      ['Source', fetchedBundle.source],
      ['Version', fetchedBundle.version],
      ['Status', fetchedBundle.status],
      ['Platforms', fetchedBundle.platforms.join(', ')],
      ['Size', resolveByteText(fetchedBundle.sizeBytes)],
      ['Delta packs', resolveDeltaPacksText(fetchedDeltaPacks)],
      ['Fingerprint', fetchedBundle.fingerprint ?? 'none'],
      ['Commit', fetchedBundle.gitSha ?? 'unknown'],
      ['Expires', fetchedBundle.expiresAt ?? 'in use'],
      ['Created', fetchedBundle.createdAt],
    ]);
  },
});

/**
 * The delta packs on one line, each by its base's number, `embedded` for a binary's bundle: `#16: 48.2 kB, 2 patches, built`,
 * a pack without a build, requested or failed, by its status alone.
 */
function resolveDeltaPacksText(deltaPacks: BundleDelta[]): string {
  if (deltaPacks.length === 0) {
    return 'none';
  }
  return deltaPacks.map(resolveDeltaPackText).join('; ');
}

function resolveDeltaPackText({
  baseBundle,
  patchCount,
  sizeBytes,
  status,
}: BundleDelta): string {
  const baseBundleNumber = baseBundle?.number ?? null;
  const baseText =
    baseBundleNumber === null ? 'embedded' : `#${baseBundleNumber}`;
  if (patchCount === null || sizeBytes === null) {
    return `${baseText}: ${status}`;
  }
  return `${baseText}: ${resolveByteText(sizeBytes)}, ${resolveQuantityText(patchCount, 'patch', 'patches')}, ${status}`;
}
