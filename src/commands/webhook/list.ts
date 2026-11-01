import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import {
  printJson,
  printTable,
  resolveDate,
  resolveYesNoText,
} from '../../utils/output.js';
import { paginationShape, resolveNextOffset } from '../../utils/pagination.js';

export default defineCommand({
  description: "List an organization's webhooks, newest first.",
  examples: [
    'hotcodepush webhook list',
    'hotcodepush webhook list --organization Acme --json',
  ],
  options: defineCommandOptions(paginationShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const listedWebhooks = await hotCodePush.organizations.webhooks.list({
      limit: options.limit,
      offset: options.offset,
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    const nextOffset = resolveNextOffset(listedWebhooks.length, options);
    if (options.json) {
      printJson({ nextOffset, webhooks: listedWebhooks });
      return;
    }
    printTable({
      emptyText: 'No webhooks.',
      headers: ['ID', 'NAME', 'FORMAT', 'URL', 'ENABLED', 'CREATED'],
      nextOffset,
      rows: listedWebhooks.map(
        ({ createdAt, format, id, isEnabled, name, url }) => [
          id,
          name,
          format,
          url,
          resolveYesNoText(isEnabled),
          resolveDate(createdAt),
        ],
      ),
    });
  },
});
