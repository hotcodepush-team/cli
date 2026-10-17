import { confirm, text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { GLOBEX_BILLING, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import billingUpdateCommand from './update.js';

vi.mock('@clack/prompts');

const ORGANIZATION_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}`;

const BILLING_PATH = `${ORGANIZATION_PATH}/billing`;

describe('billing update', () => {
  const harness = useCommandHarness();

  function readUpdateRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'PATCH');
  }

  /**
   * Globex at its $50 cap until the update writes the cap it is sent, as the reloaded organization then answers.
   */
  function respondWithBilling(): void {
    let servedOrganization = GLOBEX_ORGANIZATION;
    harness.routes[`GET ${ORGANIZATION_PATH}`] = () =>
      Response.json(servedOrganization);
    harness.routes[`GET ${BILLING_PATH}`] = () => Response.json(GLOBEX_BILLING);
    harness.routes[`PATCH ${BILLING_PATH}`] = async request => {
      const { spendingCapCents } = (await request.json()) as {
        spendingCapCents: number;
      };
      servedOrganization = { ...GLOBEX_ORGANIZATION, spendingCapCents };
      return Response.json(GLOBEX_BILLING);
    };
  }

  it('should raise the cap in cents once confirmed, stating that a raise applies now', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithBilling();

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
    respondWithBilling();

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
    respondWithBilling();

    await expect(
      billingUpdateCommand.action(
        { json: true, organization: GLOBEX_ORGANIZATION.id, spendingCap: 20 },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'lowers the spending cap of Globex from $50 to $20 a month and applies now. Devices counted this month stay counted, and if they already exceed the new cap, no further device is counted until the cap is raised or the month turns',
      ),
    );
    expect(readUpdateRequests()).toEqual([]);
  });

  it('should say nothing changes without asking when the cap is the one in force', async () => {
    respondWithBilling();

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
    respondWithBilling();

    await billingUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 100 },
      undefined,
    );

    expect(readUpdateRequests()).toEqual([]);
  });

  it('should print the billing, the derived ceiling and the reloaded organization as JSON when --json and --yes are passed', async () => {
    respondWithBilling();

    await billingUpdateCommand.action(
      {
        json: true,
        organization: GLOBEX_ORGANIZATION.id,
        spendingCap: 20,
        yes: true,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      ...GLOBEX_BILLING,
      monthlyActiveDeviceCountLimit: 20_000,
      organization: { ...GLOBEX_ORGANIZATION, spendingCapCents: 2000 },
    });
  });

  it('should ask for the cap in whole dollars when --spending-cap is missing and someone can answer', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('100');
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithBilling();

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
    respondWithBilling();

    await expect(
      billingUpdateCommand.action(
        { organization: GLOBEX_ORGANIZATION.id, yes: true },
        undefined,
      ),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      message: 'No value was given for --spending-cap.',
    });
    expect(readUpdateRequests()).toEqual([]);
  });

  it('should refuse before the confirmation when the caller is a Member', async () => {
    stubInteractiveTerminal();
    respondWithBilling();
    harness.routes[`GET ${BILLING_PATH}`] = () =>
      respondWithApiError(
        403,
        'E_FORBIDDEN',
        'Only an Owner, an Admin or a Billing member can do this.',
      );

    await expect(
      billingUpdateCommand.action(
        { organization: GLOBEX_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_FORBIDDEN' });
    expect(text).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(readUpdateRequests()).toEqual([]);
  });
});
