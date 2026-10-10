import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { GLOBEX_LIMITS, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import limitListCommand from './list.js';

describe('limit list', () => {
  const harness = useCommandHarness();

  function respondWithLimits(): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([GLOBEX_ORGANIZATION]);
    harness.routes[`GET /v1/organizations/${GLOBEX_ORGANIZATION.id}/limits`] =
      () => Response.json(GLOBEX_LIMITS);
  }

  it("should print each limit of the user's only organization with its value, its default and whether it is overridden", async () => {
    respondWithLimits();

    await limitListCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'LIMIT         VALUE  DEFAULT  OVERRIDDEN',
      'appsLimit     25     10       yes',
      'membersLimit  20     20       no',
    ]);
  });

  it("should print the API's limits as JSON when --json is passed", async () => {
    respondWithLimits();

    await limitListCommand.action(
      { json: true, organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(GLOBEX_LIMITS);
  });
});
