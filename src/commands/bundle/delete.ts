import { fetchAppId } from '../../resources/apps.js';
import {
  bundleOptionShape,
  fetchBundle,
  resolveBundleLabel,
} from '../../resources/bundles.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
  description:
    'Delete a bundle now. One a release serves or a store build embeds is refused.',
  examples: [
    'hotcodepush bundle delete --bundle 17',
    'hotcodepush bundle delete --bundle 17 --yes --json',
  ],
  options: defineCommandOptions(bundleOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(hotCodePush, {
      options,
      projectConfig: readProjectConfig(options.config),
    });
    const fetchedBundle = await fetchBundle(hotCodePush, { appId, options });
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
      printJson({ id: fetchedBundle.id, name: fetchedBundle.version });
    } else {
      printResult({
        rows: [['ID', fetchedBundle.id]],
        sentence: `Deleted bundle ${resolveBundleLabel(fetchedBundle)}.`,
      });
    }
  },
});
