import { confirm, select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, ADMIN_MEMBER } from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import { MissingParameterError } from '../../utils/errors.js';
import memberUpdateCommand from './update.js';

vi.mock('@clack/prompts');

const MEMBER_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/members/${ADMIN_MEMBER.id}`;

describe('member update', () => {
  const harness = useCommandHarness();

  function readPatchRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'PATCH');
  }

  function respondWithMember(): void {
    harness.routes[`GET ${MEMBER_PATH}`] = () => Response.json(ADMIN_MEMBER);
    harness.routes[`PATCH ${MEMBER_PATH}`] = () =>
      Response.json({ ...ADMIN_MEMBER, role: 'billing', user: undefined });
  }

  it("should change the member's role and print it", async () => {
    respondWithMember();

    await memberUpdateCommand.action(
      {
        member: ADMIN_MEMBER.id,
        organization: ACME_ORGANIZATION.id,
        role: 'billing',
      },
      undefined,
    );

    expect(await readPatchRequests()[0]?.json()).toEqual({ role: 'billing' });
    expect(harness.readLines()).toEqual([
      `Updated member bob@example.com (${ADMIN_MEMBER.id}) to role billing.`,
    ]);
  });

  it('should print the member as JSON when --json is passed', async () => {
    respondWithMember();

    await memberUpdateCommand.action(
      {
        json: true,
        member: ADMIN_MEMBER.id,
        organization: ACME_ORGANIZATION.id,
        role: 'billing',
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      ...ADMIN_MEMBER,
      role: 'billing',
      user: undefined,
    });
  });

  it('should ask for the role when interactive and --role is missing', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue('billing');
    respondWithMember();

    await memberUpdateCommand.action(
      { member: ADMIN_MEMBER.id, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which role does the member get?',
      options: ['admin', 'billing', 'member', 'owner'].map(role => ({
        label: role,
        value: role,
      })),
    });
    expect(await readPatchRequests()[0]?.json()).toEqual({ role: 'billing' });
  });

  it('should throw E_MISSING_PARAMETER and change nothing when --role is missing and nobody can be asked', async () => {
    respondWithMember();

    await expect(
      memberUpdateCommand.action(
        { member: ADMIN_MEMBER.id, organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--role'));
    expect(readPatchRequests()).toEqual([]);
  });

  it('should transfer the ownership once confirmed when --role is owner, stating the consequence', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithMember();

    await memberUpdateCommand.action(
      {
        member: ADMIN_MEMBER.id,
        organization: ACME_ORGANIZATION.id,
        role: 'owner',
      },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message:
        'This transfers the ownership of the organization to member bob@example.com and makes you an admin; only they can transfer it back. Continue?',
    });
    expect(await readPatchRequests()[0]?.json()).toEqual({ role: 'owner' });
  });

  it('should transfer the ownership without asking when --role is owner and --yes is passed', async () => {
    respondWithMember();

    await memberUpdateCommand.action(
      {
        member: ADMIN_MEMBER.id,
        organization: ACME_ORGANIZATION.id,
        role: 'owner',
        yes: true,
      },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(await readPatchRequests()[0]?.json()).toEqual({ role: 'owner' });
  });

  it("should pass the API's refusal of an ownership transfer through with its code in front", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithMember();
    harness.routes[`PATCH ${MEMBER_PATH}`] = () =>
      respondWithApiError(
        403,
        'E_FORBIDDEN',
        'Only the Owner may transfer the ownership.',
      );

    const exitCode = await runCli(
      { 'member update': () => import('./update.js') },
      [
        'member',
        'update',
        '--organization',
        ACME_ORGANIZATION.id,
        '--member',
        ADMIN_MEMBER.id,
        '--role',
        'owner',
        '--yes',
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_FORBIDDEN Only the Owner may transfer the ownership. https://hotcodepush.com/docs/cli/errors#E_FORBIDDEN\n',
    );
  });
});
