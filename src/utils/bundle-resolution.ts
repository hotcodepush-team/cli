import type { Bundle, HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { InvalidParameterError, MissingParameterError } from './errors.js';
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
 * The bundle `--bundle` names, by number or id, otherwise a picker over the app's bundles when interactive.
 */
export async function fetchBundle(
  hotCodePush: HotCodePush,
  appId: string,
  options: BundleOptions,
): Promise<Bundle> {
  if (options.bundle === undefined) {
    const bundles = await fetchBundles(hotCodePush, appId);
    const bundleId = await promptSelect(
      '--bundle',
      'Which bundle?',
      bundles.map(bundle => ({
        label: `${resolveBundleLabel(bundle)} (${bundle.state})`,
        value: bundle.id,
      })),
      options,
    );
    return resolveBundleById(bundles, bundleId);
  }
  if (ID_SCHEMA.safeParse(options.bundle).success) {
    return hotCodePush.apps.bundles.get({ appId, bundleId: options.bundle });
  }
  if (!NUMBER_PATTERN.test(options.bundle)) {
    throw new InvalidParameterError(
      `--bundle: "${options.bundle}" is neither a number nor an id`,
      undefined,
    );
  }
  const number = Number(options.bundle);
  const bundle = (await fetchBundles(hotCodePush, appId)).find(
    candidate => candidate.number === number,
  );
  if (bundle === undefined) {
    throw new InvalidParameterError(
      `--bundle: the app has no bundle #${number}`,
      undefined,
    );
  }
  return bundle;
}

export function fetchBundles(
  hotCodePush: HotCodePush,
  appId: string,
): Promise<Bundle[]> {
  return fetchAllPages(page =>
    hotCodePush.apps.bundles.list({ appId, ...page }),
  );
}

/**
 * The bundle as a person names it: the number with its prefix and the version label, `#42 · 1.4.2`.
 */
export function resolveBundleLabel({
  bundleVersion,
  number,
}: Pick<Bundle, 'bundleVersion' | 'number'>): string {
  return `#${number} · ${bundleVersion}`;
}

function resolveBundleById(bundles: Bundle[], bundleId: string): Bundle {
  const bundle = bundles.find(({ id }) => id === bundleId);
  if (bundle === undefined) {
    throw new MissingParameterError('--bundle');
  }
  return bundle;
}
