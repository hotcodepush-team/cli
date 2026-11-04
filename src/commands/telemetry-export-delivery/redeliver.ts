import { z } from 'zod';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printSettledDelivery } from '../../utils/deliveries.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson } from '../../utils/output.js';
import { confirmConsequence, promptText } from '../../utils/prompts.js';

export default defineCommand({
  description:
    "Send a telemetry export delivery again, once, and print the backend's answer. A pending delivery is taken from the retries.",
  examples: [
    'hotcodepush telemetry-export-delivery redeliver --delivery 9a4f2e71-3b8c-4d65-b1e7-0c2d5f8a6e93',
    'hotcodepush telemetry-export-delivery redeliver --delivery 9a4f2e71-3b8c-4d65-b1e7-0c2d5f8a6e93 --yes --json',
  ],
  options: defineCommandOptions({
    delivery: z
      .string()
      .optional()
      .describe(
        'The delivery, by id, as "hotcodepush telemetry-export-delivery list" prints it.',
      ),
  }),
  action: async options => {
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const fetchedExport = await hotCodePush.organizations.telemetryExport.get({
      organizationId,
    });
    // A delivery has no name to pick from, so a missing one is asked for as text.
    const deliveryId =
      options.delivery ??
      (await promptText(options, {
        flag: '--delivery',
        message: 'Which delivery id?',
      }));
    const isConfirmed = await confirmConsequence(
      `sends delivery ${deliveryId} to ${fetchedExport.url} again`,
      options,
    );
    if (!isConfirmed) {
      return;
    }
    const settledDelivery =
      await hotCodePush.organizations.telemetryExport.deliveries.redeliver({
        deliveryId,
        organizationId,
      });
    if (options.json) {
      printJson(settledDelivery);
      return;
    }
    printSettledDelivery(settledDelivery, {
      targetLabel: 'the telemetry export',
    });
  },
});
