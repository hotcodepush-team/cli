import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { booleanFlagSchema } from '../../utils/boolean-flag.js';
import { defineCommand } from '../../utils/command.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { promptSelect } from '../../utils/prompts.js';

export default defineCommand({
  description:
    'Turn the telemetry export on or off. Turning it on again after fifty failed deliveries restarts the count that disables it.',
  examples: [
    'hotcodepush telemetry-export update --enabled',
    'hotcodepush telemetry-export update --enabled false --organization Acme --json',
  ],
  options: defineCommandOptions({
    enabled: booleanFlagSchema
      .optional()
      .describe(
        'Whether the export delivers. Turning it on again restarts the count of failures that disables it. Pass false to turn it off.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const isEnabled = options.enabled ?? (await promptIsEnabled(options));
    const updatedExport =
      await hotCodePush.organizations.telemetryExport.update({
        isEnabled,
        organizationId,
      });
    if (options.json) {
      printJson(updatedExport);
      return;
    }
    printResult({
      rows: [['ID', updatedExport.id]],
      sentence: `${isEnabled ? 'Enabled' : 'Disabled'} the telemetry export for ${updatedExport.url}.`,
    });
  },
});

// The one field is the whole update, so a missing one is asked for rather than sending nothing.
async function promptIsEnabled(
  options: InteractivityOptions,
): Promise<boolean> {
  const answer = await promptSelect(options, {
    choices: [
      { label: 'Off', value: 'off' },
      { label: 'On', value: 'on' },
    ],
    flag: '--enabled',
    message: 'Should the telemetry export deliver?',
  });
  return answer === 'on';
}
