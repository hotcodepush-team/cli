import type {
  Bundle,
  BundleWithDeltaPacks,
  HotCodePush,
} from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { InvalidParameterError } from './errors.js';
import { fetchAllPages } from './pagination.js';
import { promptSelect } from './prompts.js';

export interface BundleOptions extends InteractivityOptions {
  bundle?: string;
}

const ID_SCHEMA = z.guid();
const NUMBER_PATTERN = /^\d+$/;

export const bundleOptionShape = {
  bundle: z.string().optional().describe('The bundle, by its number or id.'),
};

/**
 * The bundle `--bundle` names, by number or id, otherwise a picker over the app's bundles when interactive, read by its id
 * whichever way it was named.
 */
export async function fetchBundle(
  hotCodePush: HotCodePush,
  appId: string,
  options: BundleOptions,
): Promise<BundleWithDeltaPacks> {
  const bundleId = await fetchBundleId(hotCodePush, appId, options);
  return hotCodePush.apps.bundles.get({ appId, bundleId });
}

/**
 * The app's uploaded bundles, the ones a release or a delete names; a bundle a binary ships is never one of them.
 */
export function fetchUploadedBundles(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<Bundle[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.bundles.list({ appId, ...page, type: 'uploaded' }),
  );
}

/**
 * The bundle as a person names it: the number with its prefix and the version label, `#42 · 1.4.2`;
 * a bundle a binary ships has no number, `embedded · 1.4.2`.
 */
export function resolveBundleLabel({
  number,
  version,
}: Pick<Bundle, 'number' | 'version'>): string {
  return `${number === null ? 'embedded' : `#${number}`} · ${version}`;
}

async function fetchBundleId(
  hotCodePush: HotCodePush,
  appId: string,
  options: BundleOptions,
): Promise<string> {
  if (options.bundle === undefined) {
    const bundles = await fetchUploadedBundles(hotCodePush, appId);
    return promptSelect(
      '--bundle',
      'Which bundle?',
      bundles.map(bundle => ({
        label: `${resolveBundleLabel(bundle)} (${bundle.state})`,
        value: bundle.id,
      })),
      options,
    );
  }
  if (ID_SCHEMA.safeParse(options.bundle).success) {
    return options.bundle;
  }
  if (!NUMBER_PATTERN.test(options.bundle)) {
    throw new InvalidParameterError(
      `--bundle: "${options.bundle}" is neither a number nor an id`,
      undefined,
    );
  }
  return fetchBundleIdByNumber(hotCodePush, appId, Number(options.bundle));
}

/**
 * The id of the bundle carrying the number, found among the bundles the list's search answers, whose numbers contain it.
 */
async function fetchBundleIdByNumber(
  hotCodePush: HotCodePush,
  appId: string,
  number: number,
): Promise<string> {
  const searchedBundles = await fetchAllPages(page =>
    hotCodePush.apps.bundles.list({ appId, ...page, query: String(number) }),
  );
  const numberedBundle = searchedBundles.find(
    candidate => candidate.number === number,
  );
  if (numberedBundle === undefined) {
    throw new InvalidParameterError(
      `--bundle: the app has no bundle #${number}`,
      undefined,
    );
  }
  return numberedBundle.id;
}
