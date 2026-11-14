import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommandHarness } from '../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  STAGING_CHANNEL,
} from '../../test/fixtures.js';
import { PACKAGE_JSON } from '../config/consts.js';
import { runCli } from '../utils/cli.js';
import apiCommand from './api.js';

vi.mock('node:stream/consumers', () => ({ text: vi.fn() }));

const CHANNELS_PATH = `/v1/apps/${DEMO_APP.id}/channels`;

describe('api', () => {
  const harness = useCommandHarness();
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  function writeBodyFile(content: string): string {
    const filePath = join(directoryPath, 'body.json');
    writeFileSync(filePath, content);
    return filePath;
  }

  it('should send a GET to the path with its query string and print the JSON body', async () => {
    harness.routes['GET /v1/organizations?limit=1'] = () =>
      Response.json([ACME_ORGANIZATION]);

    await apiCommand.action({}, ['/v1/organizations?limit=1']);

    expect(harness.readJson()).toEqual([ACME_ORGANIZATION]);
  });

  it('should add the leading slash when the path comes without it', async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);

    await apiCommand.action({}, ['v1/organizations']);

    expect(harness.readJson()).toEqual([ACME_ORGANIZATION]);
  });

  it('should fill {appId} with the app of hotcodepush.json', async () => {
    harness.routes[`GET ${CHANNELS_PATH}`] = () =>
      Response.json([STAGING_CHANNEL]);

    await apiCommand.action(
      { config: harness.writeProjectConfig({ appId: DEMO_APP.id }) },
      ['/v1/apps/{appId}/channels'],
    );

    expect(harness.readJson()).toEqual([STAGING_CHANNEL]);
  });

  it('should fill {organizationId} with the organization of --organization', async () => {
    harness.routes[`GET /v1/organizations/${ACME_ORGANIZATION.id}/apps`] = () =>
      Response.json([DEMO_APP]);

    await apiCommand.action({ organization: ACME_ORGANIZATION.id }, [
      '/v1/organizations/{organizationId}/apps',
    ]);

    expect(harness.readJson()).toEqual([DEMO_APP]);
  });

  it('should refuse a placeholder the CLI cannot fill, before it fills another one and before any request', async () => {
    await expect(
      apiCommand.action({ app: DEMO_APP.name }, [
        '/v1/apps/{appId}/channels/{channelId}',
      ]),
    ).rejects.toThrow('The CLI cannot fill {channelId} in the path.');
    expect(harness.requests).toEqual([]);
  });

  it('should throw `missing_parameter` for <path> when no path is passed and nothing can ask', async () => {
    await expect(apiCommand.action({}, [])).rejects.toThrow(
      'No value was given for <path>.',
    );
  });

  it('should POST the JSON of the file when --body-path is passed, and print a JSON answer whatever the case of its content type', async () => {
    harness.routes[`POST ${CHANNELS_PATH}`] = () =>
      new Response(JSON.stringify(STAGING_CHANNEL), {
        headers: { 'Content-Type': 'Application/JSON; charset=utf-8' },
        status: 201,
      });

    await apiCommand.action({ bodyPath: writeBodyFile('{"name":"staging"}') }, [
      CHANNELS_PATH,
    ]);

    expect(await harness.requests[0]?.json()).toEqual({ name: 'staging' });
    expect(harness.readJson()).toEqual(STAGING_CHANNEL);
  });

  it('should read the body from stdin when --body-path is -', async () => {
    vi.mocked(text).mockResolvedValue('{"name":"staging"}');
    harness.routes[`POST ${CHANNELS_PATH}`] = () =>
      Response.json(STAGING_CHANNEL, { status: 201 });

    const exitCode = await runCli(
      { api: () => import('./api.js') },
      { argv: ['api', CHANNELS_PATH, '--body-path', '-'], meta: PACKAGE_JSON },
    );

    expect(exitCode).toBe(0);
    expect(text).toHaveBeenCalledWith(process.stdin);
    expect(await harness.requests[0]?.json()).toEqual({ name: 'staging' });
  });

  it('should send the method --method names and print nothing when the answer is empty, a JSON one too', async () => {
    const channelPath = `${CHANNELS_PATH}/${STAGING_CHANNEL.id}`;
    harness.routes[`DELETE ${channelPath}`] = () =>
      new Response('', { headers: { 'Content-Type': 'application/json' } });

    await apiCommand.action({ method: 'DELETE' }, [channelPath]);

    expect(harness.requests.map(({ method }) => method)).toEqual(['DELETE']);
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('should print the body as received when it is not JSON', async () => {
    const usagePath = `/v1/organizations/${ACME_ORGANIZATION.id}/usage/apps?format=csv`;
    harness.routes[`GET ${usagePath}`] = () =>
      new Response('appId,appName\n', {
        headers: { 'Content-Type': 'text/csv' },
      });

    await apiCommand.action({}, [usagePath]);

    expect(vi.mocked(process.stdout.write).mock.lastCall?.[0]).toEqual(
      new TextEncoder().encode('appId,appName\n'),
    );
  });

  it('should refuse --body-path with --method GET, before any request', async () => {
    await expect(
      apiCommand.action({ bodyPath: writeBodyFile('{}'), method: 'GET' }, [
        CHANNELS_PATH,
      ]),
    ).rejects.toThrow('A GET request sends no body');
    expect(harness.requests).toEqual([]);
  });

  it('should refuse a body that is not JSON, before any request', async () => {
    await expect(
      apiCommand.action({ bodyPath: writeBodyFile('{"name":') }, [
        CHANNELS_PATH,
      ]),
    ).rejects.toThrow('The body from --body-path is not valid JSON.');
    expect(harness.requests).toEqual([]);
  });

  it('should refuse a second argument', async () => {
    await expect(
      apiCommand.action({}, ['/v1/organizations', '/v1/apps']),
    ).rejects.toThrow('It does not take /v1/apps.');
  });
});
