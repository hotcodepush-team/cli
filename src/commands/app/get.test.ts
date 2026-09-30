import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  GLOBEX_ORGANIZATION,
} from '../../../test/fixtures.js';
import {
  AmbiguousNameError,
  MissingParameterError,
  UnknownNameError,
} from '../../utils/errors.js';
import appGetCommand from './get.js';

describe('app get', () => {
  const harness = useCommandHarness();

  function respondWithOrganizationApps(appsByOrganization: {
    [organizationId: string]: object[];
  }): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION, GLOBEX_ORGANIZATION]);
    for (const [organizationId, apps] of Object.entries(appsByOrganization)) {
      harness.routes[`GET /v1/organizations/${organizationId}/apps`] = () =>
        Response.json(apps);
    }
    harness.routes[`GET /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json(DEMO_APP);
  }

  it('should print the app of hotcodepush.json when --app is missing', async () => {
    respondWithOrganizationApps({});

    await appGetCommand.action(
      { config: harness.writeProjectConfig({ appId: DEMO_APP.id }) },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID                     ${DEMO_APP.id}`,
      'Name                   Demo',
      'Framework              capacitor',
      `Organization           ${ACME_ORGANIZATION.id}`,
      `Default channel        ${DEMO_APP.defaultChannelId}`,
      'Channel link template  none',
      'Created                2026-09-03T08:00:00.000Z',
    ]);
  });

  it("should look an app's name up in every organization of the user's", async () => {
    respondWithOrganizationApps({
      [ACME_ORGANIZATION.id]: [DEMO_APP],
      [GLOBEX_ORGANIZATION.id]: [],
    });

    await appGetCommand.action({ app: 'demo', json: true }, undefined);

    expect(harness.readJson()).toEqual(DEMO_APP);
  });

  it("should look an app's name up only in the organization --organization names", async () => {
    respondWithOrganizationApps({
      [ACME_ORGANIZATION.id]: [DEMO_APP],
      [GLOBEX_ORGANIZATION.id]: [{ ...DEMO_APP, id: GLOBEX_ORGANIZATION.id }],
    });

    await appGetCommand.action(
      { app: 'Demo', json: true, organization: 'Acme' },
      undefined,
    );

    expect(harness.readJson()).toEqual(DEMO_APP);
  });

  it('should throw E_INVALID_PARAMETER when apps of several organizations carry the name', async () => {
    respondWithOrganizationApps({
      [ACME_ORGANIZATION.id]: [DEMO_APP],
      [GLOBEX_ORGANIZATION.id]: [{ ...DEMO_APP, id: GLOBEX_ORGANIZATION.id }],
    });

    await expect(
      appGetCommand.action({ app: 'Demo' }, undefined),
    ).rejects.toThrow(AmbiguousNameError);
  });

  it('should throw E_INVALID_PARAMETER when no app carries the name', async () => {
    respondWithOrganizationApps({
      [ACME_ORGANIZATION.id]: [DEMO_APP],
      [GLOBEX_ORGANIZATION.id]: [],
    });

    await expect(
      appGetCommand.action({ app: 'Nope' }, undefined),
    ).rejects.toThrow(new UnknownNameError('app', 'Nope'));
  });

  it('should throw E_MISSING_PARAMETER when there is neither --app nor hotcodepush.json and nobody can be asked', async () => {
    await expect(appGetCommand.action({}, undefined)).rejects.toThrow(
      new MissingParameterError('--app'),
    );
  });
});
