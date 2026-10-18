import { select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { BINARY, DEMO_APP, FLEET } from '../../../test/fixtures.js';
import { FLEET_PATH, respondWithFleet } from '../../../test/release-routes.js';
import { MissingParameterError } from '../../utils/errors.js';
import binaryGetCommand from './get.js';

vi.mock('@clack/prompts');

describe('binary get', () => {
  const harness = useCommandHarness();

  it("should print the store build with the bundle it ships and the devices of its bucket in the app's fleet", async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries/${BINARY.id}`] = () =>
      Response.json(BINARY);
    respondWithFleet(harness);

    await binaryGetCommand.action(
      { app: DEMO_APP.id, binary: BINARY.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID           ${BINARY.id}`,
      'Platform     ios',
      'Version      1.0',
      'Build        1',
      'Fingerprint  none',
      `Bundle       ${BINARY.bundleId}`,
      'Devices      12',
      'Last seen    2026-09-08T08:00:00.000Z',
      `Created      ${BINARY.createdAt}`,
    ]);
  });

  it('should print no devices and never seen when the fleet has no bucket for the binary', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries/${BINARY.id}`] = () =>
      Response.json(BINARY);
    harness.routes[`GET ${FLEET_PATH}`] = () =>
      Response.json({ ...FLEET, binary: [] });

    await binaryGetCommand.action(
      { app: DEMO_APP.id, binary: BINARY.id },
      undefined,
    );

    expect(harness.readLines().slice(6, 8)).toEqual([
      'Devices      0',
      'Last seen    never',
    ]);
  });

  it('should name the flag when the id is missing', async () => {
    await expect(
      binaryGetCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toThrow(MissingParameterError);
  });

  it('should offer a picker over the store builds when the id is missing and someone can pick', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(BINARY.id);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries`] = () =>
      Response.json([BINARY]);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries/${BINARY.id}`] = () =>
      Response.json(BINARY);
    respondWithFleet(harness);

    await binaryGetCommand.action({ app: DEMO_APP.id }, undefined);

    expect(select).toHaveBeenCalledWith({
      message: 'Which store build?',
      options: [{ label: 'ios 1.0 (1)', value: BINARY.id }],
    });
    expect(harness.readLines()[0]).toBe(`ID           ${BINARY.id}`);
  });
});
