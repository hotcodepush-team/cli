import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { ACME_ORGANIZATION } from '../../../test/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import organizationUpdateCommand from './update.js';

describe('organization update', () => {
  const harness = useCommandHarness();

  it('should rename the organization and print its new name', async () => {
    harness.routes[`PATCH /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      Response.json({ ...ACME_ORGANIZATION, name: 'Acme Inc' });

    await organizationUpdateCommand.action(
      { name: 'Acme Inc', organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(await harness.requests[0]?.json()).toEqual({ name: 'Acme Inc' });
    expect(harness.readLines()).toEqual([
      `Updated organization Acme Inc (${ACME_ORGANIZATION.id}).`,
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

  it('should throw E_MISSING_PARAMETER when --name is missing and nobody can be asked', async () => {
    await expect(
      organizationUpdateCommand.action(
        { organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(MissingParameterError);
  });
});
