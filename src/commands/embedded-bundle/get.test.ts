import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../testing/command-harness.js';
import {
  DEMO_APP,
  EMBEDDED_BUNDLE,
  READY_BUNDLE,
} from '../../testing/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import embeddedBundleGetCommand from './get.js';

describe('embedded-bundle get', () => {
  const harness = useCommandHarness();

  it('should print the store build with the bundle it embeds', async () => {
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/embedded-bundles/${EMBEDDED_BUNDLE.id}?relations=bundle`
    ] = () => Response.json({ ...EMBEDDED_BUNDLE, bundle: READY_BUNDLE });

    await embeddedBundleGetCommand.action(
      { app: DEMO_APP.id, embeddedBundle: EMBEDDED_BUNDLE.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `ID              ${EMBEDDED_BUNDLE.id}`,
      'Platform        ios',
      'Binary version  1.0',
      'Binary build    1',
      'Fingerprint     none',
      `Bundle          #17 (${EMBEDDED_BUNDLE.bundleId})`,
      `Created         ${EMBEDDED_BUNDLE.createdAt}`,
    ]);
  });

  it('should name the flag when the id is missing', async () => {
    await expect(
      embeddedBundleGetCommand.action({ app: DEMO_APP.id }, undefined),
    ).rejects.toThrow(MissingParameterError);
  });
});
