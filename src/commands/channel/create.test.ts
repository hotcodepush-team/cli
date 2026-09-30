import { text } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  DEMO_APP,
  PRODUCTION_CHANNEL,
  STAGING_CHANNEL,
} from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import { InvalidParameterError } from '../../utils/errors.js';
import channelCreateCommand from './create.js';

vi.mock('@clack/prompts');

const CHANNELS_ROUTE = `POST /v1/apps/${DEMO_APP.id}/channels`;

describe('channel create', () => {
  const harness = useCommandHarness();

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-29T12:00:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function respondWithNameTaken(): void {
    harness.routes[CHANNELS_ROUTE] = () =>
      respondWithApiError(
        409,
        'E_CHANNEL_NAME_TAKEN',
        'A channel of that name exists in the app.',
      );
  }

  it("should create the channel with the flags as the API's fields", async () => {
    harness.routes[CHANNELS_ROUTE] = () =>
      Response.json(STAGING_CHANNEL, { status: 201 });

    await channelCreateCommand.action(
      {
        app: DEMO_APP.id,
        discoverable: false,
        expiresIn: '14d',
        failureAction: 'pause',
        failureMinSample: 20,
        failureThreshold: 10,
        name: 'staging',
        protected: true,
      },
      undefined,
    );

    expect(await harness.requests[0]?.json()).toEqual({
      expiresAt: '2026-10-13T12:00:00.000Z',
      failureAction: 'pause',
      failureMinSample: 20,
      failureThresholdPercent: 10,
      isDiscoverable: false,
      isProtected: true,
      name: 'staging',
    });
    expect(harness.readLines()).toEqual([
      `Created channel staging (${STAGING_CHANNEL.id}).`,
    ]);
  });

  it('should create the channel in the app of hotcodepush.json and print it as JSON', async () => {
    harness.routes[CHANNELS_ROUTE] = () =>
      Response.json(STAGING_CHANNEL, { status: 201 });

    await channelCreateCommand.action(
      {
        config: harness.writeProjectConfig({ appId: DEMO_APP.id }),
        json: true,
        name: 'staging',
      },
      undefined,
    );

    expect(harness.readJson()).toEqual(STAGING_CHANNEL);
  });

  it('should ask for the name when interactive and --name is missing', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('staging');
    harness.routes[CHANNELS_ROUTE] = () =>
      Response.json(STAGING_CHANNEL, { status: 201 });

    await channelCreateCommand.action({ app: DEMO_APP.id }, undefined);

    expect(await harness.requests[0]?.json()).toEqual({ name: 'staging' });
  });

  it('should return the existing channel when --if-not-exists is passed and the name is taken', async () => {
    respondWithNameTaken();
    harness.routes[`GET /v1/apps/${DEMO_APP.id}/channels`] = () =>
      Response.json([STAGING_CHANNEL, PRODUCTION_CHANNEL]);

    await channelCreateCommand.action(
      { app: DEMO_APP.id, ifNotExists: true, json: true, name: 'Staging' },
      undefined,
    );

    expect(harness.readJson()).toEqual(STAGING_CHANNEL);
  });

  it("should pass the API's E_CHANNEL_NAME_TAKEN through without --if-not-exists", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithNameTaken();

    const exitCode = await runCli(
      { 'channel create': () => import('./create.js') },
      ['channel', 'create', '--app', DEMO_APP.id, '--name', 'staging'],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_CHANNEL_NAME_TAKEN A channel of that name exists in the app. https://hotcodepush.com/docs/cli/errors#E_CHANNEL_NAME_TAKEN\n',
    );
  });

  it('should refuse --expires-in together with --expires-at', async () => {
    await expect(
      channelCreateCommand.action(
        {
          app: DEMO_APP.id,
          expiresAt: '2026-10-13T12:00:00.000Z',
          expiresIn: '14d',
          name: 'pr-42',
        },
        undefined,
      ),
    ).rejects.toThrow(InvalidParameterError);
    expect(harness.requests).toEqual([]);
  });

  it('should read --protected false from the command line as the field set to false', async () => {
    harness.routes[CHANNELS_ROUTE] = () =>
      Response.json(STAGING_CHANNEL, { status: 201 });

    await runCli(
      { 'channel create': () => import('./create.js') },
      [
        'channel',
        'create',
        '--app',
        DEMO_APP.id,
        '--name',
        'staging',
        '--protected',
        'false',
        '--discoverable',
        '--expires-in',
        '12h',
      ],
      PACKAGE_JSON,
    );

    expect(await harness.requests[0]?.json()).toEqual({
      expiresAt: '2026-09-30T00:00:00.000Z',
      isDiscoverable: true,
      isProtected: false,
      name: 'staging',
    });
  });
});
