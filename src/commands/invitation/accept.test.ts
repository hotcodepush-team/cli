import { select, text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  ADMIN_MEMBER,
  PENDING_INVITATION,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import { MissingParameterError } from '../../utils/errors.js';
import invitationAcceptCommand from './accept.js';

vi.mock('@clack/prompts');

const ACCEPT_PATH = `/v1/invitations/${PENDING_INVITATION.id}/accept`;

const JOINED_MEMBER = {
  ...ADMIN_MEMBER,
  role: PENDING_INVITATION.role,
  user: undefined,
};

describe('invitation accept', () => {
  const harness = useCommandHarness();

  function respondWithJoinedMember(): void {
    harness.routes['GET /v1/invitations'] = () =>
      Response.json([PENDING_INVITATION]);
    harness.routes[`POST ${ACCEPT_PATH}`] = () =>
      Response.json(JOINED_MEMBER, { status: 201 });
  }

  it('should accept the invitation with the token and print the organization joined', async () => {
    respondWithJoinedMember();

    await invitationAcceptCommand.action(
      { invitation: PENDING_INVITATION.id, token: 'token-1' },
      undefined,
    );

    expect(await harness.requests[0]?.json()).toEqual({ token: 'token-1' });
    expect(harness.readLines()).toEqual([
      `Joined organization ${ACME_ORGANIZATION.id} with role member.`,
    ]);
  });

  it('should print the membership as JSON when --json is passed', async () => {
    respondWithJoinedMember();

    await invitationAcceptCommand.action(
      { invitation: PENDING_INVITATION.id, json: true, token: 'token-1' },
      undefined,
    );

    expect(harness.readJson()).toEqual(JOINED_MEMBER);
  });

  it("should ask which of the caller's invitations and for the token when interactive and both are missing", async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(PENDING_INVITATION.id);
    vi.mocked(text).mockResolvedValue('token-1');
    respondWithJoinedMember();

    await invitationAcceptCommand.action({}, undefined);

    expect(select).toHaveBeenCalledWith({
      message: 'Which invitation?',
      options: [
        { label: 'Acme with role member', value: PENDING_INVITATION.id },
      ],
    });
    expect(await harness.requests[1]?.json()).toEqual({ token: 'token-1' });
  });

  it('should throw E_MISSING_PARAMETER when --invitation is missing and nobody can be asked', async () => {
    respondWithJoinedMember();

    await expect(
      invitationAcceptCommand.action({ token: 'token-1' }, undefined),
    ).rejects.toThrow(new MissingParameterError('--invitation'));
    expect(harness.requests).toEqual([]);
  });

  it('should throw E_MISSING_PARAMETER when --token is missing and nobody can be asked', async () => {
    respondWithJoinedMember();

    await expect(
      invitationAcceptCommand.action(
        { invitation: PENDING_INVITATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--token'));
    expect(harness.requests).toEqual([]);
  });

  it("should pass the API's refusal of a used invitation through with its code in front", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    harness.routes[`POST ${ACCEPT_PATH}`] = () =>
      respondWithApiError(
        410,
        'E_INVITATION_INVALID',
        'The invitation is no longer valid.',
      );

    const exitCode = await runCli(
      { 'invitation accept': () => import('./accept.js') },
      [
        'invitation',
        'accept',
        '--invitation',
        PENDING_INVITATION.id,
        '--token',
        'token-1',
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_INVITATION_INVALID The invitation is no longer valid. https://hotcodepush.com/docs/cli/errors#E_INVITATION_INVALID\n',
    );
  });
});
