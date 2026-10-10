import { confirm, select, text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  PENDING_INVITATION,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import {
  ConfirmationRequiredError,
  MissingParameterError,
} from '../../utils/errors.js';
import invitationCreateCommand from './create.js';

vi.mock('@clack/prompts');

const INVITATIONS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/invitations`;

describe('invitation create', () => {
  const harness = useCommandHarness();

  function readPostRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'POST');
  }

  function respondWithCreatedInvitation(): void {
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}`] = () =>
      Response.json(ACME_ORGANIZATION);
    harness.routes[`POST ${INVITATIONS_PATH}`] = () =>
      Response.json(PENDING_INVITATION, { status: 201 });
  }

  it('should invite the address once confirmed, stating the organization and the role', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithCreatedInvitation();

    await invitationCreateCommand.action(
      {
        email: 'carol@example.com',
        organization: ACME_ORGANIZATION.id,
        role: 'member',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This invites carol@example.com to organization Acme with role member. Continue?',
    });
    expect(await readPostRequests()[0]?.json()).toEqual({
      email: 'carol@example.com',
      role: 'member',
    });
    expect(harness.readLines()).toEqual([
      `Invited carol@example.com (${PENDING_INVITATION.id}) to organization Acme with role member.`,
    ]);
  });

  it('should invite nobody when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithCreatedInvitation();

    await invitationCreateCommand.action(
      {
        email: 'carol@example.com',
        organization: ACME_ORGANIZATION.id,
        role: 'member',
      },
      undefined,
    );

    expect(readPostRequests()).toEqual([]);
  });

  it('should invite without asking and print the invitation as JSON when --yes and --json are passed', async () => {
    respondWithCreatedInvitation();

    await invitationCreateCommand.action(
      {
        email: 'carol@example.com',
        json: true,
        organization: ACME_ORGANIZATION.id,
        role: 'member',
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(readPostRequests()).toHaveLength(1);
    expect(harness.readJson()).toEqual(PENDING_INVITATION);
  });

  it('should throw E_CONFIRMATION_REQUIRED with the consequence and invite nobody when nobody can be asked', async () => {
    respondWithCreatedInvitation();

    await expect(
      invitationCreateCommand.action(
        {
          email: 'carol@example.com',
          json: true,
          organization: ACME_ORGANIZATION.id,
          role: 'admin',
        },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'invites carol@example.com to organization Acme with role admin',
      ),
    );
    expect(readPostRequests()).toEqual([]);
  });

  it('should ask for the address and the role when interactive and both are missing', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('carol@example.com');
    vi.mocked(select).mockResolvedValue('billing');
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithCreatedInvitation();

    await invitationCreateCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which role does the invitee get?',
      options: ['admin', 'billing', 'member'].map(role => ({
        label: role,
        value: role,
      })),
    });
    expect(await readPostRequests()[0]?.json()).toEqual({
      email: 'carol@example.com',
      role: 'billing',
    });
  });

  it('should throw E_MISSING_PARAMETER when --email is missing and nobody can be asked', async () => {
    await expect(
      invitationCreateCommand.action(
        { organization: ACME_ORGANIZATION.id, role: 'member', yes: true },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--email'));
    expect(harness.requests).toEqual([]);
  });

  it("should pass the API's error through with its code in front", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithCreatedInvitation();
    harness.routes[`POST ${INVITATIONS_PATH}`] = () =>
      respondWithApiError(
        400,
        'E_VALIDATION',
        'The json field email is invalid: this address is a member already.',
      );

    const exitCode = await runCli(
      { 'invitation create': () => import('./create.js') },
      [
        'invitation',
        'create',
        '--organization',
        ACME_ORGANIZATION.id,
        '--email',
        'anna@example.com',
        '--role',
        'member',
        '--yes',
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_VALIDATION The json field email is invalid: this address is a member already. https://hotcodepush.com/docs/cli/errors#E_VALIDATION\n',
    );
  });
});
