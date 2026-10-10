import { z } from 'zod';
import { defineCommand } from 'zodline';
import { createApiClient } from '../../utils/api-client.js';
import { UnknownNameError } from '../../utils/errors.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';
import { promptSelect } from '../../utils/prompts.js';
import { fetchOrganizationId } from '../../utils/resource-resolution.js';

export default defineCommand({
  description:
    "Print one limit in effect for an organization: its value, the plan's default and whether it is overridden.",
  examples: [
    'hotcodepush limit get --limit appsLimit',
    'hotcodepush limit get --organization Acme --limit membersLimit --json',
  ],
  options: defineCommandOptions({
    limit: z
      .string()
      .optional()
      .describe('The limit by its key, as "hotcodepush limit list" prints it.'),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedLimits = await hotCodePush.organizations.limits.get({
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    const key =
      options.limit ??
      (await promptSelect(
        '--limit',
        'Which limit?',
        Object.keys(fetchedLimits).map(limitKey => ({
          label: limitKey,
          value: limitKey,
        })),
        options,
      ));
    const fetchedLimit = fetchedLimits[key];
    if (fetchedLimit === undefined) {
      throw new UnknownNameError('limit', key);
    }
    if (options.json) {
      printJson({ [key]: fetchedLimit });
      return;
    }
    printDetails([
      ['Limit', key],
      ['Value', String(fetchedLimit.value)],
      ['Default', String(fetchedLimit.default)],
      ['Overridden', fetchedLimit.isOverridden ? 'yes' : 'no'],
    ]);
  },
});
