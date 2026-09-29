import { select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../testing/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  STAGING_CHANNEL,
  STAGING_CHANNEL_WITH_DEVICE_COUNTS,
} from '../testing/fixtures.js';
import { openBrowser } from '../utils/browser.js';
import { MissingParameterError } from '../utils/errors.js';
import openCommand from './open.js';

vi.mock('@clack/prompts');
vi.mock('../utils/browser.js');

describe('open', () => {
  const harness = useCommandHarness();

  it("should open the app's console page from hotcodepush.json without asking the API", async () => {
    await openCommand.action(
      { config: harness.writeProjectConfig({ appId: DEMO_APP.id }) },
      undefined,
    );

    const url = `http://localhost:4300/apps/${DEMO_APP.id}`;
    expect(openBrowser).toHaveBeenCalledWith(url);
    expect(harness.requests).toEqual([]);
    expect(harness.readLines()).toEqual([`Opening ${url}`]);
  });

  it("should open the channel's page when --channel names one, printing the URL as JSON", async () => {
    harness.routes[
      `GET /v1/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`
    ] = () => Response.json(STAGING_CHANNEL_WITH_DEVICE_COUNTS);

    await openCommand.action(
      { app: DEMO_APP.id, channel: STAGING_CHANNEL.id, json: true },
      undefined,
    );

    const url = `http://localhost:4300/apps/${DEMO_APP.id}/channels/${STAGING_CHANNEL.id}`;
    expect(openBrowser).toHaveBeenCalledWith(url);
    expect(harness.readJson()).toEqual({ url });
  });

  it('should name --app when no hotcodepush.json names the app and nobody can pick', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/');

    await expect(openCommand.action({}, undefined)).rejects.toBeInstanceOf(
      MissingParameterError,
    );
  });

  it('should offer the app picker when no hotcodepush.json names the app and someone can pick', async () => {
    stubInteractiveTerminal();
    vi.spyOn(process, 'cwd').mockReturnValue('/');
    vi.mocked(select).mockResolvedValue(DEMO_APP.id);
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);

    await openCommand.action({}, undefined);

    expect(select).toHaveBeenCalledWith({
      message: 'Which app?',
      options: [{ label: 'Demo', value: DEMO_APP.id }],
    });
    expect(openBrowser).toHaveBeenCalledWith(
      `http://localhost:4300/apps/${DEMO_APP.id}`,
    );
  });
});
