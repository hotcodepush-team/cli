import { select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../testing/command-harness.js';
import {
  DEMO_APP,
  EMBEDDED_BUNDLE,
  READY_BUNDLE,
} from '../../testing/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import embeddedBundleGetCommand from './get.js';

vi.mock('@clack/prompts');

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

  it('should offer a picker over the store builds when the id is missing and someone can pick', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue(EMBEDDED_BUNDLE.id);
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/embedded-bundles`] = () =>
      Response.json([EMBEDDED_BUNDLE]);
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/embedded-bundles/${EMBEDDED_BUNDLE.id}`
    ] = () => Response.json({ ...EMBEDDED_BUNDLE, bundle: READY_BUNDLE });

    await embeddedBundleGetCommand.action({ app: DEMO_APP.id }, undefined);

    expect(select).toHaveBeenCalledWith({
      message: 'Which store build?',
      options: [{ label: 'ios 1.0 (1)', value: EMBEDDED_BUNDLE.id }],
    });
    expect(harness.readLines()[0]).toBe(
      `ID              ${EMBEDDED_BUNDLE.id}`,
    );
  });
});
