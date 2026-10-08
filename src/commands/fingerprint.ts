import { computeFingerprint } from '@hotcodepush/protocol/fingerprint';
import { defineCommand } from 'zodline';
import { readProjectFingerprintContributors } from '../utils/fingerprint.js';
import { defineCommandOptions } from '../utils/global-options.js';
import { printJson, printTable } from '../utils/output.js';
import { locateProjectConfig } from '../utils/project-config.js';

export default defineCommand({
  description:
    "Print the project's native fingerprint with the packages and the files under the extra fingerprint paths that contribute to it; local, no login.",
  examples: [
    'hotcodepush fingerprint',
    'hotcodepush fingerprint --json > fingerprint.json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const { directoryPath, projectConfig } = locateProjectConfig(
      options.config,
    );
    const contributors = await readProjectFingerprintContributors(
      directoryPath,
      projectConfig?.extraFingerprintPaths ?? [],
    );
    const fingerprint = computeFingerprint(contributors);
    if (options.json) {
      printJson({ fingerprint, ...contributors });
      return;
    }
    console.log(`Fingerprint ${fingerprint}`);
    printTable({
      emptyText: 'No installed package ships native code.',
      headers: ['PACKAGE', 'VERSION'],
      nextOffset: null,
      rows: contributors.packages.map(({ name, version }) => [name, version]),
    });
    if (contributors.extraFingerprintPaths.length > 0) {
      printTable({
        emptyText: '',
        headers: ['EXTRA FINGERPRINT PATH', 'SHA-256'],
        nextOffset: null,
        rows: contributors.extraFingerprintPaths.map(({ path, sha256 }) => [
          path,
          sha256,
        ]),
      });
    }
  },
});
