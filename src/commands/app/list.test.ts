import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  GLOBEX_ORGANIZATION,
} from '../../../test/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import { select } from '../../utils/prompt-renderers.js';
import appListCommand from './list.js';

vi.mock('../../utils/prompt-renderers.js', () =>
  import('../../../test/prompt-renderers.js').then(
    ({ promptRenderersMock }) => promptRenderersMock,
  ),
);

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

  it('should ask for the organization at a terminal and print the apps as JSON when --json is passed', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(ACME_ORGANIZATION.id);
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION, GLOBEX_ORGANIZATION]);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);

    await appListCommand.action({ json: true }, undefined);

    expect(select).toHaveBeenCalledOnce();
    expect(harness.readJson()).toEqual({ apps: [DEMO_APP], nextOffset: null });
    expect(harness.readLines()).toEqual([]);
  });

  it('should throw `missing_parameter` for the organization at a terminal when --no-input is passed', async () => {
    stubInteractiveTerminal();
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION, GLOBEX_ORGANIZATION]);

    await expect(
      appListCommand.action({ noInput: true }, undefined),
    ).rejects.toThrow(new MissingParameterError('--organization'));
    expect(select).not.toHaveBeenCalled();
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
