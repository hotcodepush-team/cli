import type { TelemetryExport } from '@hotcodepush/node';
import type { Detail } from '../utils/output.js';

export function resolveTelemetryExportDetails(
  telemetryExport: TelemetryExport,
): Detail[] {
  return [
    ['ID', telemetryExport.id],
    ['URL', telemetryExport.url],
    ['Signals', telemetryExport.signals.join(', ')],
    ['Headers', telemetryExport.headerNames.join(', ') || 'none'],
    ['Disabled at', telemetryExport.disabledAt ?? 'none'],
    ['Failures', String(telemetryExport.consecutiveFailureCount)],
  ];
}
