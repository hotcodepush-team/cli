import type { HotCodePush, Invitation } from '@hotcodepush/node';
import type { InteractivityOptions } from '../utils/environment.js';
import { fetchAllPages } from '../utils/pagination.js';
import { promptResourceId, resolveResource } from '../utils/resources.js';

interface InvitationOptions extends InteractivityOptions {
  invitation?: string;
}

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
