import { select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import {
  ACME_ORGANIZATION,
  GLOBEX_ORGANIZATION,
} from '../../testing/fixtures.js';
import { MissingParameterError, UnknownNameError } from '../../utils/errors.js';
import organizationGetCommand from './get.js';

vi.mock('@clack/prompts');

describe('organization get', () => {
  const harness = useCommandHarness();

  function respondWithOrganizations(organizations: object[]): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json(organizations);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      Response.json(ACME_ORGANIZATION);
  }

  it('should print the organization --organization names, looked up by name', async () => {
    respondWithOrganizations([GLOBEX_ORGANIZATION, ACME_ORGANIZATION]);

    await organizationGetCommand.action({ organization: 'acme' }, undefined);

    expect(harness.readLines()).toEqual([
      `ID       ${ACME_ORGANIZATION.id}`,
      'Name     Acme',
      'Plan     free',
      'Region   eu',
      'Created  2026-09-01T08:00:00.000Z',
    ]);
  });

  it('should fetch the organization --organization names by id without listing', async () => {
    respondWithOrganizations([]);

    await organizationGetCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.requests.map(({ url }) => url)).toEqual([
      `https://api.example.com/v1/organizations/${ACME_ORGANIZATION.id}`,
    ]);
    expect(harness.readJson()).toEqual(ACME_ORGANIZATION);
  });

  it("should take the user's only organization when --organization is missing", async () => {
    respondWithOrganizations([ACME_ORGANIZATION]);

    await organizationGetCommand.action({ json: true }, undefined);

    expect(harness.readJson()).toEqual(ACME_ORGANIZATION);
  });

  it('should ask which organization when interactive and the user belongs to several', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(ACME_ORGANIZATION.id);
    respondWithOrganizations([GLOBEX_ORGANIZATION, ACME_ORGANIZATION]);

    await organizationGetCommand.action({}, undefined);

    expect(select).toHaveBeenCalledWith({
      message: 'Which organization?',
      options: [
        { label: 'Globex', value: GLOBEX_ORGANIZATION.id },
        { label: 'Acme', value: ACME_ORGANIZATION.id },
      ],
    });
    expect(harness.readLines()[1]).toBe('Name     Acme');
  });

  it('should throw E_MISSING_PARAMETER when the user belongs to several and nobody can be asked', async () => {
    respondWithOrganizations([GLOBEX_ORGANIZATION, ACME_ORGANIZATION]);

    await expect(
      organizationGetCommand.action({ json: true }, undefined),
    ).rejects.toThrow(MissingParameterError);
  });

  it('should throw E_INVALID_PARAMETER when no organization carries the name', async () => {
    respondWithOrganizations([ACME_ORGANIZATION]);

    await expect(
      organizationGetCommand.action({ organization: 'Initech' }, undefined),
    ).rejects.toThrow(UnknownNameError);
  });
});
