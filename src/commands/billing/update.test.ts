import { confirm, text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { GLOBEX_BILLING, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import billingUpdateCommand from './update.js';

vi.mock('@clack/prompts');

const BILLING_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}/billing`;

const LOWERED_BILLING = { ...GLOBEX_BILLING, spendingCapCents: 2000 };

describe('billing update', () => {
  const harness = useCommandHarness();

  function readUpdateRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'PATCH');
  }

  function respondWithBilling(
    billing: object,
    updatedBilling: object = billing,
  ): void {
    harness.routes[`GET /v1/organizations/${GLOBEX_ORGANIZATION.id}`] = () =>
      Response.json(GLOBEX_ORGANIZATION);
    harness.routes[`GET ${BILLING_PATH}`] = () => Response.json(billing);
    harness.routes[`PATCH ${BILLING_PATH}`] = () =>
      Response.json(updatedBilling);
  }

  it('should raise the cap in cents once confirmed, stating that a raise applies now', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithBilling(GLOBEX_BILLING, {
      ...GLOBEX_BILLING,
      spendingCapCents: 10_000,
    });

    await billingUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 100 },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This raises the spending cap of Globex from $50 to $100 a month, applying now. Continue?',
    });
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ spendingCapCents: 10_000 });
    expect(harness.readLines()).toEqual([
      'Set the spending cap of Globex to $100 a month.',
    ]);
  });

  it('should lower the cap without asking when --yes is passed and say it applies now', async () => {
    respondWithBilling(GLOBEX_BILLING, LOWERED_BILLING);

    await billingUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 20, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ spendingCapCents: 2000 });
    expect(harness.readLines()).toEqual([
      'Lowered the spending cap of Globex to $20 a month; it applies now.',
    ]);
  });

  it('should throw E_CONFIRMATION_REQUIRED stating that a lower cap applies now and keeps the counted devices and change nothing when nobody can be asked', async () => {
    respondWithBilling(GLOBEX_BILLING);

    await expect(
      billingUpdateCommand.action(
        { json: true, organization: GLOBEX_ORGANIZATION.id, spendingCap: 20 },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'lowers the spending cap of Globex from $50 to $20 a month and applies now; devices counted this month stay counted, and if they already exceed the new cap, no further device is counted until the cap is raised or the month turns',
      ),
    );
    expect(readUpdateRequests()).toEqual([]);
  });

  it('should say nothing changes without asking when the cap is the one in force', async () => {
    respondWithBilling(GLOBEX_BILLING);

    await billingUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 50 },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(harness.readLines()).toEqual([
      'The spending cap of Globex is already $50 a month; nothing changes.',
    ]);
  });

  it('should change nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithBilling(GLOBEX_BILLING);

    await billingUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 100 },
      undefined,
    );

    expect(readUpdateRequests()).toEqual([]);
  });

  it("should print the API's billing as JSON when --json and --yes are passed", async () => {
    respondWithBilling(GLOBEX_BILLING, LOWERED_BILLING);

    await billingUpdateCommand.action(
      {
        json: true,
        organization: GLOBEX_ORGANIZATION.id,
        spendingCap: 20,
        yes: true,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual(LOWERED_BILLING);
  });

  it('should ask for the cap in whole dollars when --spending-cap is missing and someone can answer', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('100');
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithBilling(GLOBEX_BILLING);

    await billingUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'What should the organization pay at most a month, in whole dollars?',
      }),
    );
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ spendingCapCents: 10_000 });
  });

  it('should name the flag with E_MISSING_PARAMETER when it is missing and nobody can answer', async () => {
    respondWithBilling(GLOBEX_BILLING);

    await expect(
      billingUpdateCommand.action(
        { organization: GLOBEX_ORGANIZATION.id, yes: true },
        undefined,
      ),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      message: '--spending-cap is missing',
    });
    expect(readUpdateRequests()).toEqual([]);
  });
});
