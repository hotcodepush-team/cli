import type { HotCodePush, Member } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { MissingParameterError } from './errors.js';
import { fetchAllPages } from './pagination.js';
import { fetchResourceId, promptResourceId } from './resource-resolution.js';

interface MemberOptions extends InteractivityOptions {
  member?: string;
}

export const memberOptionShape = {
  member: z.string().optional().describe('The member, by id or email.'),
};

/**
 * The member `--member` names, otherwise the one picked from the organization's members when interactive,
 * with their user embedded.
 */
export async function fetchMember(
  hotCodePush: HotCodePush,
  organizationId: string,
  options: MemberOptions,
): Promise<Member> {
  return hotCodePush.organizations.members.get({
    memberId: await fetchMemberId(hotCodePush, organizationId, options),
    organizationId,
    relations: ['user'],
  });
}

/**
 * A member's email, unique in the organization, so it names the member in `--member` as a name does an app.
 */
export function resolveMemberEmail({ user }: Member): string {
  return user?.email ?? '';
}

/**
 * `--member` told apart by shape: a UUID is the id, anything else an email looked up among the members whose email contains it.
 */
async function fetchMemberId(
  hotCodePush: HotCodePush,
  organizationId: string,
  options: MemberOptions,
): Promise<string> {
  const { member } = options;
  if (member !== undefined) {
    return fetchResourceId('member', member, async () =>
      resolveNamedMembers(
        await fetchMembers(hotCodePush, organizationId, member),
      ),
    );
  }
  if (!isInteractive(options)) {
    throw new MissingParameterError('--member');
  }
  return promptResourceId(
    'member',
    resolveNamedMembers(await fetchMembers(hotCodePush, organizationId)),
    options,
  );
}

function fetchMembers(
  hotCodePush: HotCodePush,
  organizationId: string,
  query?: string,
): Promise<Member[]> {
  return fetchAllPages(page =>
    hotCodePush.organizations.members.list({
      organizationId,
      query,
      relations: ['user'],
      ...page,
    }),
  );
}

function resolveNamedMembers(
  members: Member[],
): { id: string; name: string }[] {
  return members.map(member => ({
    id: member.id,
    name: resolveMemberEmail(member),
  }));
}
