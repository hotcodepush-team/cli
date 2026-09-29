import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACKAGE_JSON } from '../config/consts.js';
import { openBrowser } from '../utils/browser.js';
import { runCli } from '../utils/cli.js';
import { LoginDeniedError, LoginExpiredError } from '../utils/errors.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';
import loginCommand from './login.js';

const keyring = vi.hoisted(() => ({
  deletePassword: vi.fn(),
  getPassword: vi.fn(),
  setPassword: vi.fn(),
}));

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return keyring;
  }),
}));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }));
vi.mock('../utils/browser.js', () => ({ openBrowser: vi.fn() }));

const API_URL = 'https://api.example.com';

const DEVICE_AUTHORIZATION = {
  device_code: 'device-code-1',
  expires_in: 1800,
  interval: 5,
  user_code: 'WDJBMJHT',
  verification_uri: 'https://console.example.com/device',
  verification_uri_complete:
    'https://console.example.com/device?user_code=WDJBMJHT',
};

const SESSION = {
  session: { id: 'session-1', userId: 'user-1' },
  user: { email: 'anna@example.com', id: 'user-1', name: 'Anna Example' },
};

const TOKEN = {
  access_token: 'session-token-1',
  expires_in: 2592000,
  scope: '',
  token_type: 'Bearer',
};

const originalStdinIsTty = process.stdin.isTTY;
const originalStdoutIsTty = process.stdout.isTTY;

function respondWithDeviceError(error: string): Response {
  return Response.json(
    { error, error_description: 'A device-flow error' },
    { status: 400 },
  );
}

describe('login', () => {
  let configHomePath: string;
  const fetchMock = vi.fn<typeof fetch>();

  function readRequests(): Request[] {
    return fetchMock.mock.calls.map(
      ([input, init]) => new Request(input, init),
    );
  }

  beforeEach(() => {
    configHomePath = mkdtempSync(join(tmpdir(), 'hotcodepush-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHomePath);
    vi.stubEnv('CI', undefined);
    vi.stubGlobal('fetch', fetchMock);
    process.stdin.isTTY = true;
    process.stdout.isTTY = true;
    keyring.setPassword.mockReset();
    fetchMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    writeUserConfig({ apiUrl: API_URL });
  });

  afterEach(() => {
    process.stdin.isTTY = originalStdinIsTty;
    process.stdout.isTTY = originalStdoutIsTty;
    vi.unstubAllGlobals();
    rmSync(configHomePath, { force: true, recursive: true });
  });

  it('should store the session token and the session id when the login is approved', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION))
      .mockResolvedValueOnce(respondWithDeviceError('authorization_pending'))
      .mockResolvedValueOnce(Response.json(TOKEN))
      .mockResolvedValueOnce(Response.json(SESSION));

    await loginCommand.action({}, undefined);

    expect(keyring.setPassword).toHaveBeenCalledWith('session-token-1');
    expect(readUserConfig()).toEqual({
      apiUrl: API_URL,
      sessionId: 'session-1',
    });
    expect(openBrowser).toHaveBeenCalledWith(
      DEVICE_AUTHORIZATION.verification_uri_complete,
    );
    expect(console.log).toHaveBeenCalledWith(
      'Open https://console.example.com/device?user_code=WDJBMJHT and approve the code WDJBMJHT.',
    );
    expect(console.log).toHaveBeenCalledWith(
      'Logged in as Anna Example (anna@example.com).',
    );
    const [codeRequest, tokenRequest, , sessionRequest] = readRequests();
    expect(codeRequest?.url).toBe(`${API_URL}/v1/auth/device/code`);
    expect(await codeRequest?.json()).toEqual({ client_id: 'hotcodepush-cli' });
    expect(codeRequest?.headers.get('X-HotCodePush-Client')).toBe(
      `cli/${PACKAGE_JSON.version}`,
    );
    expect(codeRequest?.headers.get('Authorization')).toBeNull();
    expect(await tokenRequest?.json()).toEqual({
      client_id: 'hotcodepush-cli',
      device_code: 'device-code-1',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    expect(sessionRequest?.url).toBe(`${API_URL}/v1/auth/get-session`);
    expect(sessionRequest?.headers.get('Authorization')).toBe(
      'Bearer session-token-1',
    );
  });

  it("should poll at the server's interval", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ ...DEVICE_AUTHORIZATION, interval: 7 }),
      )
      .mockResolvedValueOnce(respondWithDeviceError('authorization_pending'))
      .mockResolvedValueOnce(Response.json(TOKEN))
      .mockResolvedValueOnce(Response.json(SESSION));

    await loginCommand.action({}, undefined);

    expect(vi.mocked(setTimeout).mock.calls).toEqual([[7000], [7000]]);
  });

  it('should poll five seconds slower from a slow_down on', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION))
      .mockResolvedValueOnce(respondWithDeviceError('slow_down'))
      .mockResolvedValueOnce(respondWithDeviceError('authorization_pending'))
      .mockResolvedValueOnce(Response.json(TOKEN))
      .mockResolvedValueOnce(Response.json(SESSION));

    await loginCommand.action({}, undefined);

    expect(vi.mocked(setTimeout).mock.calls).toEqual([
      [5000],
      [10000],
      [10000],
    ]);
  });

  it('should throw E_LOGIN_EXPIRED when the code expires before it is approved', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION))
      .mockResolvedValueOnce(respondWithDeviceError('expired_token'));

    await expect(loginCommand.action({}, undefined)).rejects.toThrow(
      LoginExpiredError,
    );
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it('should throw E_LOGIN_DENIED when the login is denied', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION))
      .mockResolvedValueOnce(respondWithDeviceError('access_denied'));

    await expect(loginCommand.action({}, undefined)).rejects.toThrow(
      LoginDeniedError,
    );
    expect(keyring.setPassword).not.toHaveBeenCalled();
  });

  it("should pass any other answer of the device flow through as the API's error", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION))
      .mockResolvedValueOnce(respondWithDeviceError('invalid_grant'));

    await expect(loginCommand.action({}, undefined)).rejects.toMatchObject({
      code: 'invalid_grant',
      message: 'A device-flow error',
    });
  });

  it('should print the URL and the code as JSON and exit 3 without polling when --json is passed', async () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    fetchMock.mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION));

    const exitCode = await runCli(
      { login: () => import('./login.js') },
      ['login', '--json'],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(3);
    expect(
      JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => chunk).join('')),
    ).toEqual({
      error: {
        code: 'E_NOT_LOGGED_IN',
        fix: 'open https://console.example.com/device?user_code=WDJBMJHT and approve the code WDJBMJHT.',
        message: 'you are not logged in',
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(setTimeout).not.toHaveBeenCalled();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('should exit 3 without polling when in CI', async () => {
    vi.stubEnv('CI', 'true');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fetchMock.mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION));

    const exitCode = await runCli(
      { login: () => import('./login.js') },
      ['login'],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(3);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
