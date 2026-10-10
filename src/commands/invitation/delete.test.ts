import { confirm, select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  API_URL,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  PENDING_INVITATION,
} from '../../../test/fixtures.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
  MissingParameterError,
} from '../../utils/errors.js';
import invitationDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const INVITATIONS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/invitations`;

const OTHER_INVITATION = {
  ...PENDING_INVITATION,
  email: 'dave@example.com',
  id: '8b3f1d5a-7e2c-4a96-b0d4-6c9e2f1a8b57',
};

describe('invitation delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithInvitations(): void {
    harness.routes[`GET ${INVITATIONS_PATH}`] = () =>
      Response.json([OTHER_INVITATION, PENDING_INVITATION]);
    harness.routes[`DELETE ${INVITATIONS_PATH}/${PENDING_INVITATION.id}`] =
      () => new Response(null, { status: 204 });
  }

  it("should withdraw the pending invitation of --invitation's email once confirmed, stating the consequence", async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithInvitations();

    await invitationDeleteCommand.action(
      { invitation: 'Carol@Example.com', organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.requests[0]?.url).toBe(
      `${API_URL}${INVITATIONS_PATH}?status=pending&limit=100&offset=0`,
    );
    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This withdraws the invitation to carol@example.com: the link in its mail stops working. Continue?',
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Withdrew the invitation to carol@example.com (${PENDING_INVITATION.id}).`,
    ]);
  });

  it('should withdraw nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithInvitations();

    await invitationDeleteCommand.action(
      {
        invitation: PENDING_INVITATION.id,
        organization: ACME_ORGANIZATION.id,
      },
      undefined,
    );

    expect(readDeleteRequests()).toEqual([]);
  });

  it('should withdraw without asking and print the id and the email as the name when --yes and --json are passed', async () => {
    respondWithInvitations();

    await invitationDeleteCommand.action(
      {
        invitation: PENDING_INVITATION.id,
        json: true,
        organization: ACME_ORGANIZATION.id,
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readJson()).toEqual({
      id: PENDING_INVITATION.id,
      name: 'carol@example.com',
    });
  });

  it('should throw E_CONFIRMATION_REQUIRED with the consequence and withdraw nothing when nobody can be asked', async () => {
    respondWithInvitations();

    await expect(
      invitationDeleteCommand.action(
        {
          invitation: PENDING_INVITATION.id,
          json: true,
          organization: ACME_ORGANIZATION.id,
        },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'withdraws the invitation to carol@example.com: the link in its mail stops working',
      ),
    );
    expect(readDeleteRequests()).toEqual([]);
  });

  it('should ask which invitation by email when interactive and --invitation is missing', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(PENDING_INVITATION.id);
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithInvitations();

    await invitationDeleteCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which invitation?',
      options: [
        { label: 'dave@example.com', value: OTHER_INVITATION.id },
        { label: 'carol@example.com', value: PENDING_INVITATION.id },
      ],
    });
    expect(readDeleteRequests()).toHaveLength(1);
  });

  it('should throw E_MISSING_PARAMETER when --invitation is missing and nobody can be asked', async () => {
    respondWithInvitations();

    await expect(
      invitationDeleteCommand.action(
        { organization: ACME_ORGANIZATION.id, yes: true },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--invitation'));
    expect(readDeleteRequests()).toEqual([]);
  });

  it('should name --invitation when the organization has no pending invitation of that id or email', async () => {
    respondWithInvitations();

    await expect(
      invitationDeleteCommand.action(
        {
          invitation: 'erin@example.com',
          organization: ACME_ORGANIZATION.id,
          yes: true,
        },
        undefined,
      ),
    ).rejects.toThrow(InvalidParameterError);
    expect(readDeleteRequests()).toEqual([]);
  });
});
