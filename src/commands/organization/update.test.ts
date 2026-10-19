import { confirm, text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  GLOBEX_ORGANIZATION,
} from '../../../test/fixtures.js';
import {
  ConfirmationRequiredError,
  MissingParameterError,
} from '../../utils/errors.js';
import organizationUpdateCommand from './update.js';

vi.mock('@clack/prompts');

const GLOBEX_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}`;

describe('organization update', () => {
  const harness = useCommandHarness();

  function readUpdateRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'PATCH');
  }

  /**
   * Globex at its $50 cap; the update answers the organization with the fields it is sent.
   */
  function respondWithGlobex(): void {
    harness.routes[`GET ${GLOBEX_PATH}`] = () =>
      Response.json(GLOBEX_ORGANIZATION);
    harness.routes[`PATCH ${GLOBEX_PATH}`] = async request =>
      Response.json({
        ...GLOBEX_ORGANIZATION,
        ...((await request.json()) as object),
      });
  }

  it('should rename the organization and print it', async () => {
    harness.routes[`PATCH /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      Response.json({ ...ACME_ORGANIZATION, name: 'Acme Inc' });

    await organizationUpdateCommand.action(
      { name: 'Acme Inc', organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(await harness.requests[0]?.json()).toEqual({ name: 'Acme Inc' });
    expect(harness.readLines()).toEqual([
      `ID            ${ACME_ORGANIZATION.id}`,
      'Name          Acme Inc',
      'Plan          free',
      'Spending cap  $0 a month',
      'Region        eu',
      'Created       2026-09-01T08:00:00.000Z',
    ]);
  });

  it('should print the organization as JSON when --json is passed', async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[`PATCH /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      Response.json({ ...ACME_ORGANIZATION, name: 'Acme Inc' });

    await organizationUpdateCommand.action(
      { json: true, name: 'Acme Inc' },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      ...ACME_ORGANIZATION,
      name: 'Acme Inc',
    });
  });

  it('should throw E_MISSING_PARAMETER when --name and --spending-cap are missing and nobody can be asked', async () => {
    await expect(
      organizationUpdateCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(MissingParameterError);
  });

  it('should raise the cap in cents once confirmed, stating that it applies now', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithGlobex();

    await organizationUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 100 },
      undefined,
    );

    expect(text).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This raises the spending cap of Globex from $50 to $100 a month and applies now. Continue?',
    });
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ spendingCapCents: 10_000 });
    expect(harness.readLines()).toContain('Spending cap  $100 a month');
  });

  it('should lower the cap without asking when --yes is passed', async () => {
    respondWithGlobex();

    await organizationUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 20, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({ spendingCapCents: 2000 });
  });

  it('should throw E_CONFIRMATION_REQUIRED stating that a lower cap applies now and keeps the counted devices and change nothing when nobody can be asked', async () => {
    respondWithGlobex();

    await expect(
      organizationUpdateCommand.action(
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

  it('should change nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithGlobex();

    await organizationUpdateCommand.action(
      { organization: GLOBEX_ORGANIZATION.id, spendingCap: 100 },
      undefined,
    );

    expect(readUpdateRequests()).toEqual([]);
  });

  it("should pass the API's E_VALIDATION through without asking when the cap is the one in force", async () => {
    respondWithGlobex();
    harness.routes[`PATCH ${GLOBEX_PATH}`] = () =>
      respondWithApiError(400, 'E_VALIDATION', 'The request changes nothing.');

    await expect(
      organizationUpdateCommand.action(
        { organization: GLOBEX_ORGANIZATION.id, spendingCap: 50 },
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'E_VALIDATION' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('should send the name and the cap in one request when both are passed', async () => {
    respondWithGlobex();

    await organizationUpdateCommand.action(
      {
        json: true,
        name: 'Globex Corporation',
        organization: GLOBEX_ORGANIZATION.id,
        spendingCap: 100,
        yes: true,
      },
      undefined,
    );

    const [updateRequest] = readUpdateRequests();
    expect(await updateRequest?.json()).toEqual({
      name: 'Globex Corporation',
      spendingCapCents: 10_000,
    });
    expect(harness.readJson()).toEqual({
      ...GLOBEX_ORGANIZATION,
      name: 'Globex Corporation',
      spendingCapCents: 10_000,
    });
  });
});
