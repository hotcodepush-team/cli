import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  ADMIN_MEMBER,
  OWNER_MEMBER,
} from '../../../test/fixtures.js';
import memberListCommand from './list.js';

const MEMBERS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/members`;

describe('member list', () => {
  const harness = useCommandHarness();

  it('should print the members as a table with their names, emails and roles', async () => {
    harness.routes[`GET ${MEMBERS_PATH}?relations=user`] = () =>
      Response.json([ADMIN_MEMBER, OWNER_MEMBER]);

    await memberListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'ID                                    NAME          EMAIL             ROLE   JOINED',
      `${ADMIN_MEMBER.id}  Bob Example   bob@example.com   admin  2026-09-03`,
      `${OWNER_MEMBER.id}  Anna Example  anna@example.com  owner  2026-09-01`,
    ]);
  });

  it('should end the table with the offset of the next page when the page is full', async () => {
    harness.routes[`GET ${MEMBERS_PATH}?limit=1&offset=1&relations=user`] =
      () => Response.json([OWNER_MEMBER]);

    await memberListCommand.action(
      { limit: 1, offset: 1, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines().at(-1)).toBe('Next page: --offset 2');
  });

  it('should print the members and the next offset as JSON when --json is passed', async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[`GET ${MEMBERS_PATH}`] = () =>
      Response.json([ADMIN_MEMBER, OWNER_MEMBER]);

    await memberListCommand.action({ json: true }, undefined);

    expect(harness.readJson()).toEqual({
      members: [ADMIN_MEMBER, OWNER_MEMBER],
      nextOffset: null,
    });
  });
});
