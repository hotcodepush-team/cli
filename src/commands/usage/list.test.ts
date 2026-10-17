import type { AppUsageMonth } from '@hotcodepush/node';
import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import usageListCommand from './list.js';

const USAGE_APPS_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}/usage/apps`;

const SHOP_APP_ID = '3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7';

const APP_USAGE_MONTHS: AppUsageMonth[] = [
  {
    app: { id: DEMO_APP.id, name: 'Demo' },
    appId: DEMO_APP.id,
    dataTransferBytes: 2_500_000,
    month: '2026-10',
    monthlyActiveDeviceCount: 1200,
  },
  {
    app: { id: SHOP_APP_ID, name: 'Shop' },
    appId: SHOP_APP_ID,
    dataTransferBytes: 800,
    month: '2026-10',
    monthlyActiveDeviceCount: 34,
  },
];

describe('usage list', () => {
  const harness = useCommandHarness();

  function respondWithAppUsageMonths(
    search: string,
    appUsageMonths: AppUsageMonth[],
  ): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([GLOBEX_ORGANIZATION]);
    harness.routes[`GET ${USAGE_APPS_PATH}?${search}`] = () =>
      Response.json(appUsageMonths);
  }

  it("should list the current month's apps of the user's only organization by name, the most devices first", async () => {
    respondWithAppUsageMonths('relations=app', APP_USAGE_MONTHS);

    await usageListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'APP   MAU   DATA TRANSFER',
      'Demo  1200  2.5 MB',
      'Shop  34    800 B',
    ]);
  });

  it('should page the month --month names and print the rows with the next offset as JSON when --json is passed', async () => {
    respondWithAppUsageMonths(
      'limit=2&month=2026-09&offset=2&relations=app',
      APP_USAGE_MONTHS,
    );

    await usageListCommand.action(
      {
        json: true,
        limit: 2,
        month: '2026-09',
        offset: 2,
        organization: GLOBEX_ORGANIZATION.id,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      apps: APP_USAGE_MONTHS,
      nextOffset: 4,
    });
  });

  it('should say so when no app had devices in the month', async () => {
    respondWithAppUsageMonths('relations=app', []);

    await usageListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'No app had monthly active devices in the month.',
    ]);
  });
});
