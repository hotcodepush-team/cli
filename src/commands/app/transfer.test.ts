import { confirm, select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  GLOBEX_ORGANIZATION,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import appTransferCommand from './transfer.js';

vi.mock('@clack/prompts');

describe('app transfer', () => {
  const harness = useCommandHarness();

  function readTransferRequests(): Request[] {
    return harness.requests.filter(({ url }) => url.endsWith('/transfer'));
  }

  function respondWithAppAndOrganizations(): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION, GLOBEX_ORGANIZATION]);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);
    harness.routes[`GET /v1/organizations/${GLOBEX_ORGANIZATION.id}/apps`] =
      () => Response.json([]);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);
    harness.routes[`POST /v1/apps/${DEMO_APP.id}/transfer`] = () =>
      Response.json({ ...DEMO_APP, organizationId: GLOBEX_ORGANIZATION.id });
  }

  it('should move the app to the organization --organization names once confirmed', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithAppAndOrganizations();

    await appTransferCommand.action(
      { app: 'Demo', organization: 'Globex' },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This moves app Demo from organization Acme to organization Globex. Continue?',
    });
    expect(await readTransferRequests()[0]?.json()).toEqual({
      organizationId: GLOBEX_ORGANIZATION.id,
    });
    expect(harness.readLines()).toEqual([
      `Transferred app Demo (${DEMO_APP.id}) to organization Globex.`,
    ]);
  });

  it("should offer the user's other organizations when interactive and --organization is missing", async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(GLOBEX_ORGANIZATION.id);
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithAppAndOrganizations();

    await appTransferCommand.action({ app: DEMO_APP.id }, undefined);

    expect(select).toHaveBeenCalledWith({
      message: 'Which organization?',
      options: [{ label: 'Globex', value: GLOBEX_ORGANIZATION.id }],
    });
    expect(readTransferRequests()).toHaveLength(1);
  });

  it('should move the app without asking and print it as JSON when --yes and --json are passed', async () => {
    respondWithAppAndOrganizations();

    await appTransferCommand.action(
      {
        app: DEMO_APP.id,
        json: true,
        organization: GLOBEX_ORGANIZATION.id,
        yes: true,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      ...DEMO_APP,
      organizationId: GLOBEX_ORGANIZATION.id,
    });
  });

  it('should throw E_CONFIRMATION_REQUIRED and move nothing when nobody can be asked', async () => {
    respondWithAppAndOrganizations();

    await expect(
      appTransferCommand.action(
        { app: DEMO_APP.id, organization: 'Globex' },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'moves app Demo from organization Acme to organization Globex',
      ),
    );
    expect(readTransferRequests()).toEqual([]);
  });

  it("should pass the API's E_APP_NAME_TAKEN through when the target has an app of the name", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithAppAndOrganizations();
    harness.routes[`POST /v1/apps/${DEMO_APP.id}/transfer`] = () =>
      respondWithApiError(
        409,
        'E_APP_NAME_TAKEN',
        'An app of that name exists in the organization.',
      );

    const exitCode = await runCli(
      { 'app transfer': () => import('./transfer.js') },
      [
        'app',
        'transfer',
        '--app',
        DEMO_APP.id,
        '--organization',
        'Globex',
        '--yes',
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_APP_NAME_TAKEN An app of that name exists in the organization. https://hotcodepush.com/docs/cli/errors#E_APP_NAME_TAKEN\n',
    );
  });
});
