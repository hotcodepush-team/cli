import { describe, expect, it, vi } from 'vitest';
import {
  API_URL,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  ADMIN_MEMBER,
  OWNER_MEMBER,
} from '../../../test/fixtures.js';
import { MissingParameterError, UnknownNameError } from '../../utils/errors.js';
import { select } from '../../utils/prompt-renderers.js';
import memberGetCommand from './get.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

const ADMIN_MEMBER_WITH_ACCOUNTS = {
  ...ADMIN_MEMBER,
  user: {
    ...ADMIN_MEMBER.user,
    accounts: [
      {
        createdAt: '2026-09-03T08:00:00.000Z',
        id: '8d2a6f4c-1e7b-4c93-a5d0-2b9e7f3c6a18',
        providerId: 'github',
        userId: ADMIN_MEMBER.userId,
      },
    ],
  },
};

const MEMBERS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/members`;

const OWNER_MEMBER_WITH_ACCOUNTS = {
  ...OWNER_MEMBER,
  user: {
    ...OWNER_MEMBER.user,
    accounts: [
      {
        createdAt: '2026-09-01T08:00:00.000Z',
        id: '3e9b7c1d-5a2f-4d86-9b0e-6c4a8f2d1e57',
        providerId: 'credential',
        userId: OWNER_MEMBER.userId,
      },
    ],
  },
};

describe('member get', () => {
  const harness = useCommandHarness();

  function respondWithMembers(members: object[]): void {
    harness.routes[`GET ${MEMBERS_PATH}`] = () => Response.json(members);
    harness.routes[
      `GET ${MEMBERS_PATH}/${ADMIN_MEMBER.id}?relations=user%2Cuser.accounts`
    ] = () => Response.json(ADMIN_MEMBER_WITH_ACCOUNTS);
  }

  it('should print the member --member names, looked up by email case-insensitively', async () => {
    respondWithMembers([ADMIN_MEMBER]);

    await memberGetCommand.action(
      { member: 'Bob@Example.com', organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.requests[0]?.url).toBe(
      `${API_URL}${MEMBERS_PATH}?query=Bob%40Example.com&relations=user&limit=100&offset=0`,
    );
    expect(harness.readLines()).toEqual([
      `ID          ${ADMIN_MEMBER.id}`,
      'Name        Bob Example',
      'Email       bob@example.com',
      'Role        admin',
      'Password    no',
      'Two-factor  no',
      'Last seen   never',
      'Joined      2026-09-03T08:00:00.000Z',
    ]);
  });

  it("should print a password sign-in when the user has an account of the provider credential, and two-factor from the user's twoFactorEnabled", async () => {
    harness.routes[
      `GET ${MEMBERS_PATH}/${OWNER_MEMBER.id}?relations=user%2Cuser.accounts`
    ] = () => Response.json(OWNER_MEMBER_WITH_ACCOUNTS);

    await memberGetCommand.action(
      { member: OWNER_MEMBER.id, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines().slice(4, 6)).toEqual([
      'Password    yes',
      'Two-factor  yes',
    ]);
  });

  it('should fetch the member --member names by id without listing', async () => {
    respondWithMembers([]);

    await memberGetCommand.action(
      {
        json: true,
        member: ADMIN_MEMBER.id,
        organization: ACME_ORGANIZATION.id,
      },
      undefined,
    );

    expect(harness.requests.map(({ url }) => url)).toEqual([
      `${API_URL}${MEMBERS_PATH}/${ADMIN_MEMBER.id}?relations=user%2Cuser.accounts`,
    ]);
    expect(harness.readJson()).toEqual(ADMIN_MEMBER_WITH_ACCOUNTS);
  });

  it('should ask which member by email when interactive and --member is missing', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(ADMIN_MEMBER.id);
    respondWithMembers([ADMIN_MEMBER, OWNER_MEMBER]);

    await memberGetCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which member?',
      options: [
        { label: 'bob@example.com', value: ADMIN_MEMBER.id },
        { label: 'anna@example.com', value: OWNER_MEMBER.id },
      ],
    });
    expect(harness.readLines()[2]).toBe('Email       bob@example.com');
  });

  it('should throw `missing_parameter` when --member is missing and nobody can be asked', async () => {
    respondWithMembers([ADMIN_MEMBER]);

    await expect(
      memberGetCommand.action(
        { json: true, organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--member'));
    expect(harness.requests).toEqual([]);
  });

  it('should throw `invalid_parameter` when no member has the email', async () => {
    respondWithMembers([]);

    await expect(
      memberGetCommand.action(
        { member: 'carol@example.com', organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(UnknownNameError);
  });
});
