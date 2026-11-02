import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, SIGNING_KEY } from '../../../test/fixtures.js';
import signingKeyGetCommand from './get.js';

describe('signing-key get', () => {
  const harness = useCommandHarness();

  function respondWithSigningKey(): void {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/signing-keys`] = () =>
      Response.json([SIGNING_KEY]);
  }

  it('should print the key found by its key id with its public key', async () => {
    respondWithSigningKey();

    await signingKeyGetCommand.action(
      { app: DEMO_APP.id, signingKey: SIGNING_KEY.keyId },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID          ${SIGNING_KEY.id}`,
      `Key ID      ${SIGNING_KEY.keyId}`,
      `Public key  ${SIGNING_KEY.publicKey}`,
      `Created     ${SIGNING_KEY.createdAt}`,
    ]);
  });

  it('should print the row as served when --json is passed', async () => {
    respondWithSigningKey();

    await signingKeyGetCommand.action(
      { app: DEMO_APP.id, json: true, signingKey: SIGNING_KEY.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(SIGNING_KEY);
  });
});
