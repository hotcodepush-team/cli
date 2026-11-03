import { fetchOrganizationId } from '../../resources/organizations.js';
import { resolveTelemetryExportDetails } from '../../resources/telemetry-exports.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printDetails, printJson } from '../../utils/output.js';

export default defineCommand({
  description:
    "Print the organization's telemetry export with its URL, signals, header names and, while it is disabled, since when. The header values never print.",
  examples: [
    'hotcodepush telemetry-export get',
    'hotcodepush telemetry-export get --organization Acme --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const fetchedExport = await hotCodePush.organizations.telemetryExport.get({
      organizationId: await fetchOrganizationId(hotCodePush, options),
    });
    if (options.json) {
      printJson(fetchedExport);
      return;
    }
    printDetails(resolveTelemetryExportDetails(fetchedExport));
  },
});
