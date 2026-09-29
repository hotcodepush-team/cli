import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  bundleOptionShape,
  fetchBundle,
  resolveBundleLabel,
} from '../../utils/bundle-resolution.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const fetchedBundle = await fetchBundle(hotCodePush, appId, options);
    const isConfirmed = await confirmConsequence(
      `deletes bundle ${resolveBundleLabel(fetchedBundle)} and its files now, not by retention`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.apps.bundles.delete({
      appId,
      bundleId: fetchedBundle.id,
    });
    if (options.json) {
      printJson({
        id: fetchedBundle.id,
        name: resolveBundleLabel(fetchedBundle),
      });
    } else {
      console.log(
        `Deleted bundle ${resolveBundleLabel(fetchedBundle)} (${fetchedBundle.id}).`,
      );
    }
  },
  description:
    'Delete a bundle now; one a release serves or a store build embeds is refused.',
  examples: [
    'hotcodepush bundle delete --bundle 17',
    'hotcodepush bundle delete --bundle 17 --yes --json',
  ],
  options: defineCommandOptions(bundleOptionShape),
});
