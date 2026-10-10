import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, ADMIN_MEMBER } from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import memberDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const MEMBERS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/members`;

describe('member delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithMember(): void {
    harness.routes[`GET ${MEMBERS_PATH}`] = () => Response.json([ADMIN_MEMBER]);
    harness.routes[`GET ${MEMBERS_PATH}/${ADMIN_MEMBER.id}`] = () =>
      Response.json(ADMIN_MEMBER);
    harness.routes[`DELETE ${MEMBERS_PATH}/${ADMIN_MEMBER.id}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should remove the member --member names by email once confirmed, stating the consequence', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithMember();

    await memberDeleteCommand.action(
      { member: 'bob@example.com', organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This removes member bob@example.com from the organization. Continue?',
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Removed member bob@example.com (${ADMIN_MEMBER.id}).`,
    ]);
  });

  it('should remove nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithMember();

    await memberDeleteCommand.action(
      { member: ADMIN_MEMBER.id, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readDeleteRequests()).toEqual([]);
  });

  it('should remove without asking and print the id and the email as the name when --yes and --json are passed', async () => {
    respondWithMember();

    await memberDeleteCommand.action(
      {
        json: true,
        member: ADMIN_MEMBER.id,
        organization: ACME_ORGANIZATION.id,
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readJson()).toEqual({
      id: ADMIN_MEMBER.id,
      name: 'bob@example.com',
    });
  });

  it('should throw E_CONFIRMATION_REQUIRED with the consequence and remove nothing when nobody can be asked', async () => {
    respondWithMember();

    await expect(
      memberDeleteCommand.action(
        {
          json: true,
          member: ADMIN_MEMBER.id,
          organization: ACME_ORGANIZATION.id,
        },
        undefined,
      ),
    ).rejects.toThrow(
      new ConfirmationRequiredError(
        'removes member bob@example.com from the organization',
      ),
    );
    expect(readDeleteRequests()).toEqual([]);
  });
});
