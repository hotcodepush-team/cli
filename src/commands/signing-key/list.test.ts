import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { DEMO_APP, SIGNING_KEY } from '../../../test/fixtures.js';
import signingKeyListCommand from './list.js';

describe('signing-key list', () => {
  const harness = useCommandHarness();

  it('should list the keys with their key id and day', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/signing-keys`] = () =>
      Response.json([SIGNING_KEY]);

    await signingKeyListCommand.action({ app: DEMO_APP.id }, undefined);

    expect(harness.readLines()).toEqual([
      `${'ID'.padEnd(SIGNING_KEY.id.length)}  ${'KEY ID'.padEnd(SIGNING_KEY.keyId.length)}  CREATED`,
      `${SIGNING_KEY.id}  ${SIGNING_KEY.keyId}  2026-09-09`,
    ]);
  });

  it('should print JSON with the next offset', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/signing-keys`] = () =>
      Response.json([SIGNING_KEY]);

    await signingKeyListCommand.action(
      { app: DEMO_APP.id, json: true },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      nextOffset: null,
      signingKeys: [SIGNING_KEY],
    });
  });
});
