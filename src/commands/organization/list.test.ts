import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  GLOBEX_ORGANIZATION,
} from '../../../test/fixtures.js';
import organizationListCommand from './list.js';

describe('organization list', () => {
  const harness = useCommandHarness();

  it('should print the organizations as a table with the role in each', async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([GLOBEX_ORGANIZATION, ACME_ORGANIZATION]);

    await organizationListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'ID                                    NAME    ROLE   CREATED',
      `${GLOBEX_ORGANIZATION.id}  Globex  admin  2026-09-02`,
      `${ACME_ORGANIZATION.id}  Acme    owner  2026-09-01`,
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
  });

  it('should say so when there is no organization', async () => {
    harness.routes['GET /v1/organizations'] = () => Response.json([]);

    await organizationListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual(['No organizations.']);
  });
});
