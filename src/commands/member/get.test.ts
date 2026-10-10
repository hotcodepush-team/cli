import { select } from '@clack/prompts';
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
import memberGetCommand from './get.js';

vi.mock('@clack/prompts');

const MEMBERS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/members`;

describe('member get', () => {
  const harness = useCommandHarness();

  function respondWithMembers(members: object[]): void {
    harness.routes[`GET ${MEMBERS_PATH}`] = () => Response.json(members);
    harness.routes[`GET ${MEMBERS_PATH}/${ADMIN_MEMBER.id}?relations=user`] =
      () => Response.json(ADMIN_MEMBER);
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
      `${API_URL}${MEMBERS_PATH}/${ADMIN_MEMBER.id}?relations=user`,
    ]);
    expect(harness.readJson()).toEqual(ADMIN_MEMBER);
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

  it('should throw E_MISSING_PARAMETER when --member is missing and nobody can be asked', async () => {
    respondWithMembers([ADMIN_MEMBER]);

    await expect(
      memberGetCommand.action(
        { json: true, organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--member'));
    expect(harness.requests).toEqual([]);
  });

  it('should throw E_INVALID_PARAMETER when no member has the email', async () => {
    respondWithMembers([]);

    await expect(
      memberGetCommand.action(
        { member: 'carol@example.com', organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(UnknownNameError);
  });
});
