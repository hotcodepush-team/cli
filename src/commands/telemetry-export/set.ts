import { z } from 'zod';
import { fetchOrganizationId } from '../../resources/organizations.js';
import { resolveTelemetryExportDetails } from '../../resources/telemetry-exports.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import type { InteractivityOptions } from '../../utils/environment.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { resolveNameValuePairs } from '../../utils/name-value-pairs.js';
import { printJson, printResult } from '../../utils/output.js';
import { promptSelect, promptText } from '../../utils/prompts.js';

// Validated in the schema, so a wrong signal is reported under the flag name.
const signalListSchema = z
  .string()
  .transform(value => value.split(',').map(signal => signal.trim()))
  .pipe(z.array(z.enum(['logs', 'metrics'])).min(1));

export default defineCommand({
  description:
    "Set the organization's telemetry export, replacing the one before whole: the base URL, the headers the backend authenticates with, and the signals. Every header is given again, since the stored values never leave the API. The export starts enabled.",
  examples: [
    'hotcodepush telemetry-export set --url https://api.honeycomb.io --header "x-honeycomb-team=$HONEYCOMB_API_KEY" --signal logs,metrics',
    'hotcodepush telemetry-export set --url https://otlp.example.com --header "Authorization=Bearer $OTLP_TOKEN" --signal logs --json',
  ],
  options: defineCommandOptions({
    header: z
      .array(z.string())
      .optional()
      .describe(
        "A header sent with every request, such as the backend's authorization header, as name=value.",
      ),
    signal: signalListSchema
      .optional()
      .describe(
        'The signals to export, comma-separated: logs, metrics or both.',
      ),
    url: z
      .string()
      .optional()
      .describe(
        'The OTLP/HTTP base URL, without the /v1/logs or /v1/metrics path.',
      ),
  }),
  action: async options => {
    const headerPairs = resolveNameValuePairs(options.header, {
      flag: '--header',
    });
    const hotCodePush = createApiClient();
    const organizationId = await fetchOrganizationId(hotCodePush, options);
    const url =
      options.url ??
      (await promptText(options, {
        flag: '--url',
        message: 'What is the OTLP/HTTP base URL?',
      }));
    const signals = options.signal ?? (await promptSignals(options));
    const updatedExport = await hotCodePush.organizations.telemetryExport.set({
      headers: Object.fromEntries(
        headerPairs.map(({ name, value }) => [name, value]),
      ),
      organizationId,
      signals,
      url,
    });
    if (options.json) {
      printJson(updatedExport);
      return;
    }
    printResult({
      rows: resolveTelemetryExportDetails(updatedExport),
      sentence: `Set the telemetry export for ${updatedExport.url}.`,
    });
  },
});

async function promptSignals(
  options: InteractivityOptions,
): Promise<z.output<typeof signalListSchema>> {
  const answer = await promptSelect(options, {
    choices: [
      { label: 'Logs', value: 'logs' },
      { label: 'Logs and metrics', value: 'logs,metrics' },
      { label: 'Metrics', value: 'metrics' },
    ],
    flag: '--signal',
    message: 'Which signals should the export send?',
  });
  return signalListSchema.parse(answer);
}
