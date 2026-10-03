import type { HotCodePush } from '@hotcodepush/node';
import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { isInteractive } from '../../utils/environment.js';
import { MissingParameterError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { fetchAllPages } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { promptSelect } from '../../utils/prompts.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    'Print a registered store build with the bundle it ships and the devices running it.',
  examples: [
    'hotcodepush binary get --binary 6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    'hotcodepush binary get --binary 6ba7b810-9dad-41d1-80b4-00c04fd430c8 --json',
  ],
  options: defineCommandOptions({
    binary: z.string().optional().describe('The binary, by id.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const appId = await fetchAppId(
      hotCodePush,
      options,
      readProjectConfig(options.config),
    );
    const fetchedBinary = await hotCodePush.apps.binaries.get({
      appId,
      binaryId:
        options.binary ?? (await promptBinaryId(hotCodePush, appId, options)),
    });
    if (options.json) {
      printJson(fetchedBinary);
      return;
    }
    printDetails([
      ['ID', fetchedBinary.id],
      ['Platform', fetchedBinary.platform],
      ['Binary version', fetchedBinary.binaryVersion],
      ['Binary build', fetchedBinary.binaryBuild],
      ['Fingerprint', fetchedBinary.fingerprint ?? 'none'],
      ['Bundle', fetchedBinary.bundleId],
      ['Devices', String(fetchedBinary.deviceCount)],
      ['Last seen', fetchedBinary.lastSeenAt ?? 'never'],
      ['Created', fetchedBinary.createdAt],
    ]);
  },
});

/**
 * The store build picked from the app's binaries when interactive; otherwise the flag is missing.
 */
async function promptBinaryId(
  hotCodePush: HotCodePush,
  appId: string,
  options: InteractivityOptions,
): Promise<string> {
  if (!isInteractive(options)) {
    throw new MissingParameterError('--binary');
  }
  const binaries = await fetchAllPages(page =>
    hotCodePush.apps.binaries.list({ appId, ...page }),
  );
  return promptSelect(
    '--binary',
    'Which store build?',
    binaries.map(({ binaryBuild, binaryVersion, id, platform }) => ({
      label: `${platform} ${binaryVersion} (${binaryBuild})`,
      value: id,
    })),
    options,
  );
}
