import { readFileSync } from 'node:fs';
import { confirm } from '@clack/prompts';
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

const OTHER_PUBLIC_KEY = resolveProtocolSigningKey('rsa-4096-b').publicKey;

describe('signing-key delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithSigningKey(): void {
    harness.routes[`GET ${SIGNING_KEYS_PATH}`] = () =>
      Response.json([SIGNING_KEY]);
    harness.routes[`DELETE ${SIGNING_KEYS_PATH}/${SIGNING_KEY.id}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should unregister the key named by its fingerprint once confirmed and take it out of publicKeys in hotcodepush.json', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithSigningKey();
    const configPath = harness.writeProjectConfig({
      appId: DEMO_APP.id,
      publicKeys: [SIGNING_KEY.publicKey, OTHER_PUBLIC_KEY],
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
      publicKeys: [OTHER_PUBLIC_KEY],
    });
    expect(harness.readLines()).toEqual([
      `Deleted signing key ${SIGNING_KEY.fingerprint} (${SIGNING_KEY.id}).`,
    ]);
  });

  it('should print the id and the fingerprint as JSON under --yes', async () => {
    respondWithSigningKey();

    await signingKeyDeleteCommand.action(
      { app: DEMO_APP.id, json: true, signingKey: SIGNING_KEY.id, yes: true },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      fingerprint: SIGNING_KEY.fingerprint,
      id: SIGNING_KEY.id,
    });
  });

  it('should throw E_CONFIRMATION_REQUIRED and delete nothing when nobody can be asked', async () => {
    respondWithSigningKey();

    await expect(
      signingKeyDeleteCommand.action(
        { app: DEMO_APP.id, signingKey: SIGNING_KEY.id },
        undefined,
      ),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);

    expect(readDeleteRequests()).toHaveLength(0);
  });

  it('should name --signing-key when the app has no key of that id or fingerprint', async () => {
    respondWithSigningKey();

    await expect(
      signingKeyDeleteCommand.action(
        { app: DEMO_APP.id, signingKey: 'sha256:unknown', yes: true },
        undefined,
      ),
    ).rejects.toThrow(InvalidParameterError);

    expect(readDeleteRequests()).toHaveLength(0);
  });
});
