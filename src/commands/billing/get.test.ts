import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { GLOBEX_BILLING, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import billingGetCommand from './get.js';

const BILLING_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}/billing`;

describe('billing get', () => {
  const harness = useCommandHarness();

  function respondWithBilling(billing: object): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([GLOBEX_ORGANIZATION]);
    harness.routes[`GET ${BILLING_PATH}`] = () => Response.json(billing);
  }

  it("should print the plan, the cap and the month's devices against the ceiling of the user's only organization", async () => {
    respondWithBilling(GLOBEX_BILLING);

    await billingGetCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'Plan          pay_as_you_go',
      'Spending cap  $50 a month',
      'MAU           1,234 of 5,000',
      'Capped        no',
    ]);
  });

  it('should print the lower cap waiting with its month and when the cap was reached', async () => {
    respondWithBilling({
      ...GLOBEX_BILLING,
      cappedAt: '2026-10-08T12:00:00.000Z',
      countedMau: 5000,
      nextSpendingCapCents: 2000,
      nextSpendingCapStartsAt: '2026-11-01T00:00:00.000Z',
    });

    await billingGetCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'Plan               pay_as_you_go',
      'Spending cap       $50 a month',
      'Next spending cap  $20 a month from 2026-11-01T00:00:00.000Z',
      'MAU                5,000 of 5,000',
      'Capped             since 2026-10-08T12:00:00.000Z',
    ]);
  });

  it('should say an Enterprise deal without a MAU limit has no ceiling', async () => {
    respondWithBilling({ ...GLOBEX_BILLING, mauCap: null, plan: 'enterprise' });

    await billingGetCommand.action({}, undefined);

    expect(harness.readLines()).toContain('MAU           1,234, no ceiling');
  });

  it("should print the API's billing as JSON for the organization --organization names by id without listing", async () => {
    respondWithBilling(GLOBEX_BILLING);

    await billingGetCommand.action(
      { json: true, organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(harness.requests.map(({ url }) => url)).toEqual([
      `https://api.example.com${BILLING_PATH}`,
    ]);
    expect(harness.readJson()).toEqual(GLOBEX_BILLING);
  });
});
