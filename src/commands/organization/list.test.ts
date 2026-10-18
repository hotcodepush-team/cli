import { beforeEach, describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  GLOBEX_ORGANIZATION,
  RUNNER_USER,
  RUNNER_USER_WITH_MEMBERS,
} from '../../../test/fixtures.js';
import organizationListCommand from './list.js';

const USER_PATH = 'GET /v1/users/me?relations=members';

describe('organization list', () => {
  const harness = useCommandHarness();

  beforeEach(() => {
    harness.routes[USER_PATH] = () => Response.json(RUNNER_USER_WITH_MEMBERS);
  });

  it("should print the organizations as a table with the role of the user's member row in each", async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([GLOBEX_ORGANIZATION, ACME_ORGANIZATION]);

    await organizationListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'ID                                    NAME    ROLE   CREATED',
      `${GLOBEX_ORGANIZATION.id}  Globex  admin  2026-09-02`,
      `${ACME_ORGANIZATION.id}  Acme    owner  2026-09-01`,
    ]);
    expect(
      harness.requests.filter(({ url }) => url.includes('/v1/users/me')),
    ).toHaveLength(1);
  });

  it('should leave the role empty for an organization the user has no member row in', async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[USER_PATH] = () =>
      Response.json({ ...RUNNER_USER, members: [] });

    await organizationListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'ID                                    NAME  ROLE  CREATED',
      `${ACME_ORGANIZATION.id}  Acme        2026-09-01`,
    ]);
  });

  it('should end the table with the offset of the next page when the page is full', async () => {
    harness.routes['GET /v1/organizations?limit=1&offset=1'] = () =>
      Response.json([ACME_ORGANIZATION]);

    await organizationListCommand.action({ limit: 1, offset: 1 }, undefined);

    expect(harness.readLines().at(-1)).toBe('Next page: --offset 2');
  });

  it('should print the organizations and the next offset as JSON when --json is passed', async () => {
    harness.routes['GET /v1/organizations?limit=2'] = () =>
      Response.json([ACME_ORGANIZATION]);

    await organizationListCommand.action({ json: true, limit: 2 }, undefined);

    expect(harness.readJson()).toEqual({
      nextOffset: null,
      organizations: [ACME_ORGANIZATION],
    });
    expect(
      harness.requests.filter(({ url }) => url.includes('/v1/users/me')),
    ).toEqual([]);
  });

  it('should say so when there is no organization', async () => {
    harness.routes['GET /v1/organizations'] = () => Response.json([]);

    await organizationListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual(['No organizations.']);
  });
});
