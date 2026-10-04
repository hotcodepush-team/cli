import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printTable, resolveDate } from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';
import { readProjectConfig } from '../../utils/project-config.js';
import { fetchAppId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "List the app's signing keys, newest first, with the fingerprint a signature names.",
  examples: [
    'hotcodepush signing-key list',
    'hotcodepush signing-key list --app "My App" --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedSigningKeys = await hotCodePush.apps.signingKeys.list({
      appId: await fetchAppId(
        hotCodePush,
        options,
        readProjectConfig(options.config),
      ),
      limit: options.limit,
      offset: options.offset,
    });
    const nextOffset = resolveNextOffset(listedSigningKeys.length, options);
    if (options.json) {
      printJson({ nextOffset, signingKeys: listedSigningKeys });
      return;
    }
    printTable({
      emptyText: 'No signing keys; signing-key create enables code signing.',
      headers: ['ID', 'FINGERPRINT', 'CREATED'],
      nextOffset,
      rows: listedSigningKeys.map(({ createdAt, fingerprint, id }) => [
        id,
        fingerprint,
        resolveDate(createdAt),
      ]),
    });
  },
});
