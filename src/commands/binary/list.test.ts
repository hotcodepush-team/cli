import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { BINARY, DEMO_APP } from '../../../test/fixtures.js';
import binaryListCommand from './list.js';

describe('binary list', () => {
  const harness = useCommandHarness();

  it('should list the registered store builds with their bundle and devices', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries`] = () =>
      Response.json([BINARY, { ...BINARY, deviceCount: 0, lastSeenAt: null }]);

    await binaryListCommand.action({ app: DEMO_APP.id }, undefined);

    expect(harness.readLines()).toEqual([
      'ID                                    VERSION  BUILD  PLATFORM  BUNDLE                                DEVICES  LAST SEEN',
      `${BINARY.id}  1.0      1      ios       ${BINARY.bundleId}  12       2026-09-08`,
      `${BINARY.id}  1.0      1      ios       ${BINARY.bundleId}  0        never`,
    ]);
  });

  it('should print JSON with the next offset', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries`] = () =>
      Response.json([]);

    await binaryListCommand.action({ app: DEMO_APP.id, json: true }, undefined);

    expect(harness.readJson()).toEqual({ binaries: [], nextOffset: null });
  });
});
