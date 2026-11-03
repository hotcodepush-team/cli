import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printSettledDelivery } from '../../utils/deliveries.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResultGap } from '../../utils/output.js';
import { confirmConsequence } from '../../utils/prompts.js';

export default defineCommand({
  description:
    "Send one record per enabled signal through the export's delivery path and print each delivery with the backend's answer.",
  examples: [
    'hotcodepush telemetry-export test',
    'hotcodepush telemetry-export test --organization Acme --yes --json',
  ],
  options: defineCommandOptions({}),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const fetchedExport = await hotCodePush.organizations.telemetryExport.get({
      organizationId,
    });
    const isConfirmed = await confirmConsequence(
      `sends one record per enabled signal to ${fetchedExport.url}`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const settledDeliveries =
      await hotCodePush.organizations.telemetryExport.test({ organizationId });
    if (options.json) {
      printJson(settledDeliveries);
      return;
    }
    settledDeliveries.forEach((delivery, index) => {
      if (index > 0) {
        printResultGap();
      }
      printSettledDelivery(delivery, { targetLabel: 'the telemetry export' });
    });
  },
});
