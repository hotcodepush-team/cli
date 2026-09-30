import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import {
  bundleOptionShape,
  fetchBundle,
} from '../../utils/bundle-resolution.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { resolveByteText } from '../../utils/progress.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description: 'Print a bundle, by its number or id.',
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
      ['Number', `#${fetchedBundle.number}`],
      ['Version', fetchedBundle.bundleVersion],
      ['State', fetchedBundle.state],
      ['Platforms', fetchedBundle.platforms.join(', ')],
      ['Size', resolveByteText(fetchedBundle.sizeBytes)],
      ['Fingerprint', fetchedBundle.fingerprint ?? 'none'],
      ['Commit', fetchedBundle.gitSha ?? 'unknown'],
      ['Expires', fetchedBundle.expiresAt ?? 'in use'],
      ['Created', fetchedBundle.createdAt],
    ]);
  },
});
