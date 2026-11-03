import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
  description:
    "Delete the organization's telemetry export with its delivery log: nothing more is sent, and its headers are forgotten.",
  examples: [
    'hotcodepush telemetry-export delete',
    'hotcodepush telemetry-export delete --organization Acme --yes --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const fetchedExport = await hotCodePush.organizations.telemetryExport.get({
      organizationId,
    });
    const isConfirmed = await confirmConsequence(
      `deletes the telemetry export: nothing more is sent to ${fetchedExport.url} and its headers are forgotten`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    await hotCodePush.organizations.telemetryExport.delete({ organizationId });
    if (options.json) {
      printJson({ id: fetchedExport.id, name: fetchedExport.url });
    } else {
      printResult({
        rows: [['ID', fetchedExport.id]],
        sentence: `Deleted the telemetry export for ${fetchedExport.url}.`,
      });
    }
  },
});
