import type { Bundle, HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { InvalidParameterError } from './errors.js';
import { fetchAllPages } from './pagination.js';
import { ID_SCHEMA } from './project-config.js';
import { promptSelect } from './prompts.js';

export interface BundleOptions extends InteractivityOptions {
  bundle?: string;
}

const NUMBER_PATTERN = /^\d+$/;

export const bundleOptionShape = {
  bundle: z.string().optional().describe('The bundle, by its number or id.'),
};

export async function fetchBundle(
  hotCodePush: HotCodePush,
  appId: string,
  options: BundleOptions,
): Promise<Bundle> {
  const bundleId = await fetchBundleId(hotCodePush, appId, options);
  return hotCodePush.apps.bundles.get({ appId, bundleId });
}

// A bundle that a binary ships is never in this list.
export function fetchUploadedBundles(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<Bundle[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.bundles.list({ appId, ...page, source: 'upload' }),
  );
}

// A bundle that a binary ships has no number, so it reads `embedded · 1.4.2`.
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
        label: `${resolveBundleLabel(bundle)} (${bundle.status})`,
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
      `The value "${options.bundle}" of --bundle is neither a number nor an id.`,
    );
  }
  return fetchBundleIdByNumber(hotCodePush, appId, Number(options.bundle));
}

// The list search matches numbers that contain the given one, so the exact match is picked here.
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
      `The app has no bundle #${number} from --bundle.`,
    );
  }
  return numberedBundle.id;
}
