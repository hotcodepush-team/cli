import type { Bundle, HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from '../utils/environment.js';
import { InvalidParameterError } from '../utils/errors.js';
import { fetchAllPages } from '../utils/pagination.js';
import { promptSelect } from '../utils/prompts.js';
import { isId, isNumber } from '../utils/reference.js';

export interface BundleOptions extends InteractivityOptions {
  bundle?: string;
}

export const bundleOptionShape = {
  bundle: z.string().optional().describe('The bundle, by its number or id.'),
};

export async function fetchBundle(
  hotCodePush: HotCodePush,
  { appId, options }: { appId: string; options: BundleOptions },
): Promise<Bundle> {
  const bundleId = await fetchBundleId(hotCodePush, { appId, options });
  return hotCodePush.apps.bundles.get({ appId, bundleId });
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
  { appId, options }: { appId: string; options: BundleOptions },
): Promise<string> {
  if (options.bundle === undefined) {
    const bundles = await fetchUploadedBundles(hotCodePush, appId);
    return promptSelect(options, {
      choices: bundles.map(bundle => ({
        label: `${resolveBundleLabel(bundle)} (${bundle.status})`,
        value: bundle.id,
      })),
      flag: '--bundle',
      message: 'Which bundle?',
    });
  }
  if (isId(options.bundle)) {
    return options.bundle;
  }
  if (!isNumber(options.bundle)) {
    throw new InvalidParameterError(
      `The value "${options.bundle}" of --bundle is neither a number nor an id.`,
    );
  }
  return fetchBundleIdByNumber(hotCodePush, {
    appId,
    number: Number(options.bundle),
  });
}

// The list search matches numbers that contain the given one, so the exact match is picked here.
async function fetchBundleIdByNumber(
  hotCodePush: HotCodePush,
  { appId, number }: { appId: string; number: number },
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

// A bundle that a binary ships is never in this list.
function fetchUploadedBundles(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<Bundle[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.bundles.list({ appId, ...page, source: 'upload' }),
  );
}
