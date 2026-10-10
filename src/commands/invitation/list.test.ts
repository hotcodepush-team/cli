import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  PENDING_INVITATION,
} from '../../../test/fixtures.js';
import invitationListCommand from './list.js';

const INVITATIONS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/invitations`;

describe('invitation list', () => {
  const harness = useCommandHarness();

  it('should print the pending invitations as a table with their emails, roles and expiry', async () => {
    harness.routes[`GET ${INVITATIONS_PATH}?status=pending`] = () =>
      Response.json([PENDING_INVITATION]);

    await invitationListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'ID                                    EMAIL              ROLE    EXPIRES     CREATED',
      `${PENDING_INVITATION.id}  carol@example.com  member  2026-09-12  2026-09-10`,
    ]);
  });

  it('should end the table with the offset of the next page when the page is full', async () => {
    harness.routes[`GET ${INVITATIONS_PATH}?limit=1&offset=1&status=pending`] =
      () => Response.json([PENDING_INVITATION]);

    await invitationListCommand.action(
      { limit: 1, offset: 1, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines().at(-1)).toBe('Next page: --offset 2');
  });

  it('should print the invitations and the next offset as JSON when --json is passed', async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[`GET ${INVITATIONS_PATH}`] = () =>
      Response.json([PENDING_INVITATION]);

    await invitationListCommand.action({ json: true }, undefined);

    expect(harness.readJson()).toEqual({
      invitations: [PENDING_INVITATION],
      nextOffset: null,
    });
  });

  it('should say so when there is no pending invitation', async () => {
    harness.routes[`GET ${INVITATIONS_PATH}`] = () => Response.json([]);

    await invitationListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual(['No pending invitations.']);
  });
});
