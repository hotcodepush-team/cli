import type { HotCodePush, Invitation, Member } from '@hotcodepush/node';
import { z } from 'zod';
import type { InteractivityOptions } from './environment.js';
import { fetchAllPages } from './pagination.js';
import {
  fetchOrPromptResourceId,
  promptResourceId,
  resolveResource,
} from './resource-resolution.js';

interface InvitationOptions extends InteractivityOptions {
  invitation?: string;
}

interface MemberOptions extends InteractivityOptions {
  member?: string;
}

export const memberOptionShape = {
  member: z.string().optional().describe('The member, by id or email.'),
};

// Invitations have no read by id, and only a pending one is unique by its email.
export async function fetchPendingInvitation(
  hotCodePush: HotCodePush,
  organizationId: string,
  options: InvitationOptions,
): Promise<Invitation> {
  const pendingInvitations = await fetchAllPages(page =>
    hotCodePush.organizations.invitations.list({
      organizationId,
      status: 'pending',
      ...page,
    }),
  );
  const namedInvitations = pendingInvitations.map(invitation => ({
    ...invitation,
    name: invitation.email,
  }));
  const reference =
    options.invitation ??
    (await promptResourceId('invitation', namedInvitations, options));
  return resolveResource('invitation', reference, namedInvitations);
}

export async function fetchMember(
  hotCodePush: HotCodePush,
  organizationId: string,
  options: MemberOptions,
): Promise<Member> {
  return hotCodePush.organizations.members.get({
    memberId: await fetchMemberId(hotCodePush, organizationId, options),
    organizationId,
    relations: ['user', 'user.accounts'],
  });
}

// The email is unique in the organization, so it names a member the way a name does an app.
export function resolveMemberEmail({ user }: Member): string {
  return user?.email ?? '';
}

// `users.get` embeds the member rows of the caller.
export function resolveMemberRole(
  members: Pick<Member, 'organizationId' | 'role'>[],
  organizationId: string,
): Member['role'] | null {
  return (
    members.find(member => member.organizationId === organizationId)?.role ??
    null
  );
}

// A UUID is the id. Anything else is an email, matched among the members whose email contains it.
async function fetchMemberId(
  hotCodePush: HotCodePush,
  organizationId: string,
  options: MemberOptions,
): Promise<string> {
  return fetchOrPromptResourceId({
    fetchResources: async () =>
      resolveNamedMembers(
        await fetchMembers(hotCodePush, organizationId, options.member),
      ),
    noun: 'member',
    options,
    reference: options.member,
  });
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
