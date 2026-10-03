import { select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { BINARY, DEMO_APP } from '../../../test/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import binaryGetCommand from './get.js';

vi.mock('@clack/prompts');

describe('binary get', () => {
  const harness = useCommandHarness();

  it('should print the store build with the bundle it ships and its devices', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries/${BINARY.id}`] = () =>
      Response.json(BINARY);

    await binaryGetCommand.action(
      { app: DEMO_APP.id, binary: BINARY.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID              ${BINARY.id}`,
      'Platform        ios',
      'Binary version  1.0',
      'Binary build    1',
      'Fingerprint     none',
      `Bundle          ${BINARY.bundleId}`,
      'Devices         12',
      `Last seen       ${BINARY.lastSeenAt}`,
      `Created         ${BINARY.createdAt}`,
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

    await binaryGetCommand.action({ app: DEMO_APP.id }, undefined);

    expect(select).toHaveBeenCalledWith({
      message: 'Which store build?',
      options: [{ label: 'ios 1.0 (1)', value: BINARY.id }],
    });
    expect(harness.readLines()[0]).toBe(`ID              ${BINARY.id}`);
  });
});
