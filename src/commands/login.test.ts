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

function captureStdout() {
  const stdoutWrite = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  return {
    clear: () => stdoutWrite.mockClear(),
    read: () => stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
  };
}

function respondWithDeviceError(error: string): Response {
  return Response.json(
    { error, error_description: 'A device-flow error' },
    { status: 400 },
  );
}

function runLogin(flags: string[]) {
  return runCli(
    { login: () => import('./login.js') },
    ['login', ...flags],
    PACKAGE_JSON,
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
    vi.useFakeTimers({ toFake: ['Date'] });
    keyring.setPassword.mockReset();
    fetchMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeUserConfig({ apiUrl: API_URL });
  });

  afterEach(() => {
    process.stdin.isTTY = originalStdinIsTty;
    process.stdout.isTTY = originalStdoutIsTty;
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
    expect(process.stderr.write).toHaveBeenCalledWith(
      'Open https://console.example.com/device?user_code=WDJBMJHT and approve the code WDJBMJHT.\nWaiting for the approval…\n',
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

  describe('when it cannot wait for the approval', () => {
    it('should keep the code and print the URL and the code as JSON, exiting 3 without polling', async () => {
      vi.setSystemTime(new Date('2026-09-29T10:00:00.000Z'));
      const stdout = captureStdout();
      fetchMock.mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION));

      const exitCode = await runLogin(['--json']);

      expect(exitCode).toBe(3);
      expect(JSON.parse(stdout.read())).toEqual({
        error: {
          code: 'E_NOT_LOGGED_IN',
          fix: 'approve at https://console.example.com/device?user_code=WDJBMJHT with code WDJBMJHT, then run "hotcodepush login" again.',
          message: 'you are not logged in',
        },
      });
      expect(readUserConfig()).toEqual({
        apiUrl: API_URL,
        pendingDeviceCode: 'device-code-1',
        pendingDeviceCodeExpiresAt: '2026-09-29T10:30:00.000Z',
        pendingUserCode: 'WDJBMJHT',
        pendingVerificationUrl:
          'https://console.example.com/device?user_code=WDJBMJHT',
      });
      expect(readRequests().map(request => request.url)).toEqual([
        `${API_URL}/v1/auth/device/code`,
      ]);
      expect(setTimeout).not.toHaveBeenCalled();
      expect(openBrowser).not.toHaveBeenCalled();
    });

    it('should exit 3 without polling when in CI', async () => {
      vi.stubEnv('CI', 'true');
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      fetchMock.mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION));

      const exitCode = await runLogin([]);

      expect(exitCode).toBe(3);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('should log in with the kept code on the next login once it is approved', async () => {
      const stdout = captureStdout();
      fetchMock.mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION));
      await runLogin(['--json']);
      fetchMock
        .mockResolvedValueOnce(Response.json(TOKEN))
        .mockResolvedValueOnce(Response.json(SESSION));
      stdout.clear();

      const exitCode = await runLogin(['--json']);

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout.read())).toEqual({ user: SESSION.user });
      expect(keyring.setPassword).toHaveBeenCalledWith('session-token-1');
      expect(readUserConfig()).toEqual({
        apiUrl: API_URL,
        sessionId: 'session-1',
      });
      const [, tokenRequest, sessionRequest] = readRequests();
      expect(tokenRequest?.url).toBe(`${API_URL}/v1/auth/device/token`);
      expect(await tokenRequest?.json()).toMatchObject({
        device_code: 'device-code-1',
      });
      expect(sessionRequest?.url).toBe(`${API_URL}/v1/auth/get-session`);
      expect(setTimeout).not.toHaveBeenCalled();
    });
  });

  describe('when a non-interactive login kept a code', () => {
    const KEPT_VERIFICATION_URL =
      'https://console.example.com/device?user_code=KEPTCODE';

    function writeKeptCode(expiresAt: Date): void {
      writeUserConfig({
        apiUrl: API_URL,
        pendingDeviceCode: 'device-code-0',
        pendingDeviceCodeExpiresAt: expiresAt.toISOString(),
        pendingUserCode: 'KEPTCODE',
        pendingVerificationUrl: KEPT_VERIFICATION_URL,
      });
    }

    beforeEach(() => {
      writeKeptCode(new Date(Date.now() + 60_000));
    });

    it.each(['access_denied', 'expired_token', 'invalid_grant'])(
      'should keep a new code instead when the kept one answers %s',
      async error => {
        captureStdout();
        fetchMock
          .mockResolvedValueOnce(respondWithDeviceError(error))
          .mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION));

        const exitCode = await runLogin(['--json']);

        expect(exitCode).toBe(3);
        expect(readRequests().map(request => request.url)).toEqual([
          `${API_URL}/v1/auth/device/token`,
          `${API_URL}/v1/auth/device/code`,
        ]);
        expect(readUserConfig()).toMatchObject({
          pendingDeviceCode: 'device-code-1',
          pendingUserCode: 'WDJBMJHT',
        });
      },
    );

    it('should request a new code without asking about the kept one when it expired', async () => {
      captureStdout();
      writeKeptCode(new Date(Date.now() - 1));
      fetchMock.mockResolvedValueOnce(Response.json(DEVICE_AUTHORIZATION));

      await runLogin(['--json']);

      expect(readRequests().map(request => request.url)).toEqual([
        `${API_URL}/v1/auth/device/code`,
      ]);
      expect(readUserConfig().pendingDeviceCode).toBe('device-code-1');
    });

    it('should show the kept code again and exit 3 when it still waits for its approval', async () => {
      const stdout = captureStdout();
      fetchMock.mockResolvedValueOnce(
        respondWithDeviceError('authorization_pending'),
      );

      const exitCode = await runLogin(['--json']);

      expect(exitCode).toBe(3);
      expect(JSON.parse(stdout.read())).toEqual({
        error: {
          code: 'E_NOT_LOGGED_IN',
          fix: `approve at ${KEPT_VERIFICATION_URL} with code KEPTCODE, then run "hotcodepush login" again.`,
          message: 'you are not logged in',
        },
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(readUserConfig().pendingDeviceCode).toBe('device-code-0');
    });

    it('should show the kept code and poll it when interactive and it still waits', async () => {
      fetchMock
        .mockResolvedValueOnce(respondWithDeviceError('authorization_pending'))
        .mockResolvedValueOnce(respondWithDeviceError('authorization_pending'))
        .mockResolvedValueOnce(Response.json(TOKEN))
        .mockResolvedValueOnce(Response.json(SESSION));

      await loginCommand.action({}, undefined);

      expect(process.stderr.write).toHaveBeenCalledWith(
        `Open ${KEPT_VERIFICATION_URL} and approve the code KEPTCODE.\nWaiting for the approval…\n`,
      );
      expect(openBrowser).toHaveBeenCalledWith(KEPT_VERIFICATION_URL);
      expect(vi.mocked(setTimeout).mock.calls).toEqual([[5000], [5000]]);
      const tokenRequests = readRequests().slice(0, 3);
      for (const tokenRequest of tokenRequests) {
        expect(tokenRequest.url).toBe(`${API_URL}/v1/auth/device/token`);
        expect(await tokenRequest.json()).toMatchObject({
          device_code: 'device-code-0',
        });
      }
      expect(readUserConfig()).toEqual({
        apiUrl: API_URL,
        sessionId: 'session-1',
      });
    });
  });
});
