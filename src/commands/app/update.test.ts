import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../testing/command-harness.js';
import { DEMO_APP } from '../../testing/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import appUpdateCommand from './update.js';

describe('app update', () => {
  const harness = useCommandHarness();

  it('should rename the app of hotcodepush.json and print its new name', async () => {
    harness.routes[`PATCH /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json({ ...DEMO_APP, name: 'Demo 2' });

    await appUpdateCommand.action(
      {
        config: harness.writeProjectConfig({ appId: DEMO_APP.id }),
        name: 'Demo 2',
      },
      undefined,
    );

    expect(await harness.requests[0]?.json()).toEqual({ name: 'Demo 2' });
    expect(harness.readLines()).toEqual([
      `Updated app Demo 2 (${DEMO_APP.id}).`,
    ]);
  });

  it('should print the app as JSON when --json is passed', async () => {
    harness.routes[`PATCH /v1/apps/${DEMO_APP.id}`] = () =>
      Response.json({ ...DEMO_APP, name: 'Demo 2' });

    await appUpdateCommand.action(
      { app: DEMO_APP.id, json: true, name: 'Demo 2' },
      undefined,
    );

    expect(harness.readJson()).toEqual({ ...DEMO_APP, name: 'Demo 2' });
  });

  it('should throw E_MISSING_PARAMETER when --name is missing and nobody can be asked', async () => {
    await expect(
      appUpdateCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toThrow(new MissingParameterError('--name'));
  });
});
