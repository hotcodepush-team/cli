import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../testing/command-harness.js';
import { ACME_ORGANIZATION, DEMO_APP } from '../../testing/fixtures.js';
import appListCommand from './list.js';

describe('app list', () => {
  const harness = useCommandHarness();

  it("should print the organization's apps as a table", async () => {
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);

    await appListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'ID                                    NAME  FRAMEWORK  CREATED',
      `${DEMO_APP.id}  Demo  capacitor  2026-09-03`,
    ]);
  });

  it('should print the apps and the next offset as JSON when --json is passed', async () => {
    harness.routes[
      `GET /v1/organizations/${ACME_ORGANIZATION.id}/apps?limit=1`
    ] = () => Response.json([DEMO_APP]);

    await appListCommand.action(
      { json: true, limit: 1, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual({ apps: [DEMO_APP], nextOffset: 1 });
  });

  it('should say so when the organization has no app', async () => {
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([]);

    await appListCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual(['No apps.']);
  });
});
