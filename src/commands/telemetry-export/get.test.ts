import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, TELEMETRY_EXPORT } from '../../../test/fixtures.js';
import telemetryExportGetCommand from './get.js';

const TELEMETRY_EXPORT_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/telemetry-export`;

describe('telemetry-export get', () => {
  const harness = useCommandHarness();

  it('should print the export with its header names, since when it is disabled and its failures', async () => {
    harness.routes[`GET ${TELEMETRY_EXPORT_PATH}`] = () =>
      Response.json({
        ...TELEMETRY_EXPORT,
        consecutiveFailureCount: 50,
        disabledAt: '2026-09-14T10:00:00.000Z',
        headerNames: ['Authorization', 'x-tenant'],
      });

    await telemetryExportGetCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID           ${TELEMETRY_EXPORT.id}`,
      'URL          https://otlp.example.com',
      'Signals      logs, metrics',
      'Headers      Authorization, x-tenant',
      'Disabled at  2026-09-14T10:00:00.000Z',
      'Failures     50',
    ]);
  });

  it('should print the export as the API answers it when --json is passed', async () => {
    harness.routes[`GET ${TELEMETRY_EXPORT_PATH}`] = () =>
      Response.json(TELEMETRY_EXPORT);

    await telemetryExportGetCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(TELEMETRY_EXPORT);
  });
});
