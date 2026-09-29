import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import { ACME_ORGANIZATION, DEMO_APP } from '../../testing/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import organizationDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

describe('organization delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithOrganizationAndApps(apps: object[]): void {
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      Response.json(ACME_ORGANIZATION);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json(apps);
    harness.routes[`DELETE /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should delete the organization once confirmed, stating the apps that go with it', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithOrganizationAndApps([DEMO_APP, { ...DEMO_APP, name: 'Other' }]);

    await organizationDeleteCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: 'This deletes organization Acme and its 2 apps. Continue?',
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Deleted organization Acme (${ACME_ORGANIZATION.id}).`,
    ]);
  });

  it('should delete nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithOrganizationAndApps([]);

    await organizationDeleteCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readDeleteRequests()).toEqual([]);
  });

  it('should delete without asking and print the id and name of what went when --yes and --json are passed', async () => {
    respondWithOrganizationAndApps([]);

    await organizationDeleteCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readJson()).toEqual({
      id: ACME_ORGANIZATION.id,
      name: 'Acme',
    });
  });

  it('should throw E_CONFIRMATION_REQUIRED with the consequence and delete nothing when nobody can be asked', async () => {
    respondWithOrganizationAndApps([DEMO_APP]);

    await expect(
      organizationDeleteCommand.action(
        { json: true, organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError('deletes organization Acme and its 1 app'),
    );
    expect(readDeleteRequests()).toEqual([]);
  });
});
