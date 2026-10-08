import { readFileSync } from 'node:fs';
import { confirm } from '@clack/prompts';
import type { SigningKey } from '@hotcodepush/node';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  resolveProtocolSigningKey,
  SIGNING_KEY,
} from '../../../test/fixtures.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
} from '../../utils/errors.js';
import signingKeyDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const SIGNING_KEYS_PATH = `/v1/apps/${DEMO_APP.id}/signing-keys`;

const OTHER_KEY_PAIR = resolveProtocolSigningKey('rsa-4096-b');

const OTHER_SIGNING_KEY: SigningKey = {
  ...SIGNING_KEY,
  fingerprint: OTHER_KEY_PAIR.fingerprint,
  id: '9a0e7d4c-1b2a-4f5e-8b1f-3c2d4f6b7a5e',
  publicKey: OTHER_KEY_PAIR.publicKey,
};

describe('signing-key delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithSigningKeys(
    signingKeys = [SIGNING_KEY, OTHER_SIGNING_KEY],
  ): void {
    harness.routes[`GET ${SIGNING_KEYS_PATH}`] = () =>
      Response.json(signingKeys);
    harness.routes[`DELETE ${SIGNING_KEYS_PATH}/${SIGNING_KEY.id}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should unregister the key named by its fingerprint once confirmed and take it out of publicKeys in hotcodepush.json', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithSigningKeys();
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      publicKeys: [SIGNING_KEY.publicKey, OTHER_SIGNING_KEY.publicKey],
    });

    await signingKeyDeleteCommand.action(
      { config: configPath, signingKey: SIGNING_KEY.fingerprint },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This unregisters signing key ${SIGNING_KEY.fingerprint}: an upload signed with it is refused from then on. Continue?`,
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      appId: DEMO_APP.id,
      publicKeys: [OTHER_SIGNING_KEY.publicKey],
    });
    expect(harness.readLines()).toEqual([
      `Deleted signing key ${SIGNING_KEY.fingerprint} (${SIGNING_KEY.id}).`,
    ]);
  });

  it("should state what deleting the app's last key does to its binaries, asking and once deleted", async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithSigningKeys([SIGNING_KEY]);
    const consequence =
      'binaries built with this key refuse unsigned releases until they are replaced';

    await signingKeyDeleteCommand.action(
      { app: DEMO_APP.id, signingKey: SIGNING_KEY.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This unregisters signing key ${SIGNING_KEY.fingerprint}: ${consequence}. Continue?`,
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Deleted signing key ${SIGNING_KEY.fingerprint} (${SIGNING_KEY.id}): ${consequence}.`,
    ]);
  });

  it('should print the id and the fingerprint as the name, the shape of every delete, as JSON under --yes', async () => {
    respondWithSigningKeys();

    await signingKeyDeleteCommand.action(
      { app: DEMO_APP.id, json: true, signingKey: SIGNING_KEY.id, yes: true },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      id: SIGNING_KEY.id,
      name: SIGNING_KEY.fingerprint,
    });
  });

  it('should throw E_CONFIRMATION_REQUIRED and delete nothing when nobody can be asked', async () => {
    respondWithSigningKeys();

    await expect(
      signingKeyDeleteCommand.action(
        { app: DEMO_APP.id, signingKey: SIGNING_KEY.id },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readDeleteRequests()).toHaveLength(0);
  });

  it('should name --signing-key when the app has no key of that id or fingerprint', async () => {
    respondWithSigningKeys();

    await expect(
      signingKeyDeleteCommand.action(
        { app: DEMO_APP.id, signingKey: 'sha256:unknown', yes: true },
        undefined,
      ),
    ).rejects.toThrow(InvalidParameterError);

    expect(readDeleteRequests()).toHaveLength(0);
  });
});
