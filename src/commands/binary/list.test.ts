import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { BINARY, DEMO_APP } from '../../../test/fixtures.js';
import { FLEET_PATH, respondWithFleet } from '../../../test/release-routes.js';
import binaryListCommand from './list.js';

describe('binary list', () => {
  const harness = useCommandHarness();

  it("should list the binaries with their bundle and the devices of the app's fleet, none and never seen without a bucket", async () => {
    const unseenBinaryId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries`] = () =>
      Response.json([BINARY, { ...BINARY, id: unseenBinaryId }]);
    respondWithFleet(harness);

    await binaryListCommand.action({ app: DEMO_APP.id }, undefined);

    expect(harness.readLines()).toEqual([
      'ID                                    VERSION  BUILD  PLATFORM  BUNDLE                                DEVICES  LAST SEEN',
      `${BINARY.id}  1.0      1      ios       ${BINARY.bundleId}  12       2026-09-08`,
      `${unseenBinaryId}  1.0      1      ios       ${BINARY.bundleId}  0        never`,
    ]);
    const fleetUrl = harness.requests
      .map(({ url }) => new URL(url))
      .find(({ pathname }) => pathname === FLEET_PATH);
    expect(fleetUrl?.searchParams.has('channelId')).toBe(false);
  });

  it('should print JSON with the next offset', async () => {
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/binaries`] = () =>
      Response.json([]);

    await binaryListCommand.action({ app: DEMO_APP.id, json: true }, undefined);

    expect(harness.readJson()).toEqual({ binaries: [], nextOffset: null });
  });
});
