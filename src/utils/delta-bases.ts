import type { Binary, HotCodePush } from '@hotcodepush/node';
import type { ManifestFile } from '@hotcodepush/protocol';
import { resolveBundleLabel } from './bundle-resolution.js';
import { fetchAllPages } from './pagination.js';
import type { Platform } from './upload.js';

/**
 * A bundle a device runs before it asks for the new one, with its files: the upload makes a delta pack against it.
 */
export interface DeltaBase {
  bundleId: string;
  files: ManifestFile[];
  /** Whether its delta pack carries the main bundle as a patch: the newest earlier bundle's and every binary's do. */
  isPatchable: boolean;
  label: string;
  platforms: Platform[];
}

export interface FetchDeltaBasesOptions {
  appId: string;
  fingerprint: string;
  platforms: Platform[];
}

/** The bundle files list allows ten times the other lists' page, so a base at the file limit takes ten reads. */
export const BASE_FILES_PAGE_SIZE = 1000;

/**
 * Per platform, so fresh builds of one platform never crowd out the other's. A device on an older binary gets the full pack,
 * as one without a base does: a team making a store build every night under one fingerprint would otherwise pay a base
 * fetch and a diff per binary ever made on every upload.
 */
const BINARY_BASE_COUNT = 3;

const EARLIER_BUNDLE_BASE_COUNT = 3;

/**
 * The bases of a new bundle's delta packs: the three newest earlier complete uploaded bundles with its fingerprint that
 * share a platform with it, and the three newest binaries with its fingerprint on each platform it names, by when they
 * were created, whose base is the binary's embedded bundle.
 */
export async function fetchDeltaBases(
  hotCodePush: HotCodePush,
  options: FetchDeltaBasesOptions,
): Promise<DeltaBase[]> {
  const { appId, fingerprint, platforms } = options;
  const [earlierBundles, binaries] = await Promise.all([
    hotCodePush.apps.bundles.list({
      appId,
      fingerprint,
      limit: EARLIER_BUNDLE_BASE_COUNT,
      // a bundle names at least one of the two platforms, so one that names both shares a platform with every other
      platform: platforms.length === 1 ? platforms[0] : undefined,
      state: 'ready',
      type: 'uploaded',
    }),
    fetchNewestBinaries(hotCodePush, options),
  ]);
  const bases = [
    ...earlierBundles.map((bundle, index) => ({
      bundleId: bundle.id,
      isPatchable: index === 0,
      label: resolveBundleLabel(bundle),
      platforms: bundle.platforms,
    })),
    ...binaries.map(binary => ({
      bundleId: binary.bundleId,
      isPatchable: true,
      label: `the binary ${binary.platform} ${binary.version} (${binary.build})`,
      platforms: [binary.platform],
    })),
  ];
  return Promise.all(
    bases.map(async base => ({
      ...base,
      files: await fetchAllPages(
        page =>
          hotCodePush.apps.bundles.files.list({
            appId,
            bundleId: base.bundleId,
            ...page,
          }),
        BASE_FILES_PAGE_SIZE,
      ),
    })),
  );
}

/**
 * The three newest binaries with the fingerprint on each platform the bundle names, one list per platform, newest first within it.
 */
async function fetchNewestBinaries(
  hotCodePush: HotCodePush,
  { appId, fingerprint, platforms }: FetchDeltaBasesOptions,
): Promise<Binary[]> {
  const binariesPerPlatform = await Promise.all(
    platforms.map(platform =>
      hotCodePush.apps.binaries.list({
        appId,
        fingerprint,
        limit: BINARY_BASE_COUNT,
        platform,
      }),
    ),
  );
  return binariesPerPlatform.flat();
}
