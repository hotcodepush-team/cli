import { describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  FAILED_TELEMETRY_EXPORT_DELIVERY,
} from '../../../test/fixtures.js';
import telemetryExportDeliveryListCommand from './list.js';

const DELIVERIES_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/telemetry-export/deliveries`;

describe('telemetry-export-delivery list', () => {
  const harness = useCommandHarness();

  function readListUrl(): URL | undefined {
    return harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === DELIVERIES_PATH);
  }

  it('should list the deliveries with their time, type, status, answer and attempts', async () => {
    harness.routes[`GET ${DELIVERIES_PATH}`] = () =>
      Response.json([FAILED_TELEMETRY_EXPORT_DELIVERY]);

    await telemetryExportDeliveryListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'ID                                    TIME                      TYPE             STATUS  RESPONSE  ATTEMPTS',
      `${FAILED_TELEMETRY_EXPORT_DELIVERY.id}  2026-09-12T09:00:00.000Z  release.created  failed  HTTP 503  3`,
    ]);
  });

  it('should send the status and a duration as the timestamp it reaches back to', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-12T12:00:00.000Z') });
    harness.routes[`GET ${DELIVERIES_PATH}`] = () => Response.json([]);

    await telemetryExportDeliveryListCommand.action(
      {
        createdSince: '2h',
        organization: ACME_ORGANIZATION.id,
        status: 'failed',
      },
      undefined,
    );
    vi.useRealTimers();

    expect(Object.fromEntries(readListUrl()?.searchParams ?? [])).toEqual({
      createdSince: '2026-09-12T10:00:00.000Z',
      status: 'failed',
    });
    expect(harness.readLines()).toEqual(['No deliveries match.']);
  });

  it('should print the page as served and the next offset when --json is passed', async () => {
    harness.routes[`GET ${DELIVERIES_PATH}`] = () =>
      Response.json([FAILED_TELEMETRY_EXPORT_DELIVERY]);

    await telemetryExportDeliveryListCommand.action(
      { json: true, limit: 1, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      nextOffset: 1,
      telemetryExportDeliveries: [FAILED_TELEMETRY_EXPORT_DELIVERY],
    });
  });
});
