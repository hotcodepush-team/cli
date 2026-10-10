import type { Usage } from '@hotcodepush/node';
import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import usageGetCommand from './get.js';

const USAGE_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}/usage`;

const USAGE: Usage = {
  apps: [
    { appId: DEMO_APP.id, appName: 'Demo', bytes: 2_500_000, mau: 1200 },
    {
      appId: '3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7',
      appName: 'Shop',
      bytes: 800,
      mau: 34,
    },
  ],
  month: '2026-10',
  total: { bytes: 2_500_800, mau: 1234 },
};

describe('usage get', () => {
  const harness = useCommandHarness();

  function respondWithUsage(usage: Usage): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([GLOBEX_ORGANIZATION]);
    harness.routes[`GET ${USAGE_PATH}`] = () => Response.json(usage);
  }

  it("should print the current month's apps with the total of the user's only organization, asking for no month", async () => {
    respondWithUsage(USAGE);

    await usageGetCommand.action({}, undefined);

    expect(harness.requests.map(({ url }) => url)).toContain(
      `https://api.example.com${USAGE_PATH}`,
    );
    expect(harness.readLines()).toEqual([
      'APP               MAU   BYTES',
      'Demo              1200  2.5 MB',
      'Shop              34    800 B',
      'Total in 2026-10  1234  2.5 MB',
    ]);
  });

  it("should ask for the month --month names and print the API's usage as JSON when --json is passed", async () => {
    const septemberUsage = { ...USAGE, month: '2026-09' };
    respondWithUsage(USAGE);
    harness.routes[`GET ${USAGE_PATH}?month=2026-09`] = () =>
      Response.json(septemberUsage);

    await usageGetCommand.action(
      { json: true, month: '2026-09', organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(septemberUsage);
  });

  it('should print the total alone when no app had devices in the month', async () => {
    respondWithUsage({ ...USAGE, apps: [], total: { bytes: 0, mau: 0 } });

    await usageGetCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'APP               MAU  BYTES',
      'Total in 2026-10  0    0 B',
    ]);
  });
});
