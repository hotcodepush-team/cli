import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { DEMO_APP, DEVICE } from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import deviceDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const DEVICE_PATH = `/v1/apps/${DEMO_APP.id}/devices/${DEVICE.id}`;

describe('device delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  it('should delete the registry row once confirmed', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    harness.routes[`DELETE ${DEVICE_PATH}`] = () =>
      new Response(null, { status: 204 });

    await deviceDeleteCommand.action(
      { app: DEMO_APP.id, device: DEVICE.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This deletes device ${DEVICE.id}'s registry row for good, the erasure request; the device reports again with its next check. Continue?`,
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([`Deleted device ${DEVICE.id}.`]);
  });

  it('should print the id with a null name as JSON when --yes and --json are passed', async () => {
    harness.routes[`DELETE ${DEVICE_PATH}`] = () =>
      new Response(null, { status: 204 });

    await deviceDeleteCommand.action(
      { app: DEMO_APP.id, device: DEVICE.id, json: true, yes: true },
      undefined,
    );

    expect(harness.readJson()).toEqual({ id: DEVICE.id, name: null });
  });

  it('should stop with E_CONFIRMATION_REQUIRED when nobody can confirm', async () => {
    await expect(
      deviceDeleteCommand.action(
        { app: DEMO_APP.id, device: DEVICE.id },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readDeleteRequests()).toEqual([]);
  });
});
