import type { Organization } from '@hotcodepush/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { GLOBEX_BILLING, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import billingGetCommand from './get.js';

const ORGANIZATION_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}`;

const BILLING_PATH = `${ORGANIZATION_PATH}/billing`;

describe('billing get', () => {
  const harness = useCommandHarness();

  afterEach(() => {
    vi.useRealTimers();
  });

  function respondWithBilling(
    organization: Organization = GLOBEX_ORGANIZATION,
    billing: object = GLOBEX_BILLING,
  ): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([organization]);
    harness.routes[`GET ${ORGANIZATION_PATH}`] = () =>
      Response.json(organization);
    harness.routes[`GET ${BILLING_PATH}`] = () => Response.json(billing);
  }

  it("should print the plan, the cap and the month's devices against the ceiling of the user's only organization", async () => {
    respondWithBilling();

    await billingGetCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'Plan          pay_as_you_go',
      'Spending cap  $50 a month',
      'MAU           1,234 of 50,000',
      'Capped        no',
    ]);
  });

  it('should print when the month reached the cap', async () => {
    vi.useFakeTimers({
      now: new Date('2026-10-20T12:00:00.000Z'),
      toFake: ['Date'],
    });
    respondWithBilling(
      { ...GLOBEX_ORGANIZATION, cappedAt: '2026-10-08T12:00:00.000Z' },
      { ...GLOBEX_BILLING, monthlyActiveDeviceCount: 50_000 },
    );

    await billingGetCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'Plan          pay_as_you_go',
      'Spending cap  $50 a month',
      'MAU           50,000 of 50,000',
      'Capped        since 2026-10-08T12:00:00.000Z',
    ]);
  });

  it("should say the month is not capped when the cap was reached in an earlier month the month's first report has not cleared", async () => {
    vi.useFakeTimers({
      now: new Date('2026-10-01T00:30:00.000Z'),
      toFake: ['Date'],
    });
    respondWithBilling({
      ...GLOBEX_ORGANIZATION,
      cappedAt: '2026-09-28T12:00:00.000Z',
    });

    await billingGetCommand.action({}, undefined);

    expect(harness.readLines()).toContain('Capped        no');
  });

  it('should say an Enterprise deal without a device limit has no ceiling', async () => {
    respondWithBilling({ ...GLOBEX_ORGANIZATION, plan: 'enterprise' });

    await billingGetCommand.action({}, undefined);

    expect(harness.readLines()).toContain('MAU           1,234, no ceiling');
  });

  it('should print the billing, the derived ceiling and the organization as JSON for the organization --organization names by id without listing', async () => {
    respondWithBilling();

    await billingGetCommand.action(
      { json: true, organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(harness.requests.map(({ url }) => url).sort()).toEqual([
      `https://api.example.com${ORGANIZATION_PATH}`,
      `https://api.example.com${BILLING_PATH}`,
    ]);
    expect(harness.readJson()).toEqual({
      ...GLOBEX_BILLING,
      monthlyActiveDeviceCountLimit: 50_000,
      organization: GLOBEX_ORGANIZATION,
    });
  });
});
