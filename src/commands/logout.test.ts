import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotLoggedInError } from '../utils/errors.js';
import { readUserConfig, writeUserConfig } from '../utils/user-config.js';
import logoutCommand from './logout.js';

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

const API_URL = 'https://api.example.com';

describe('logout', () => {
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
    vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);
    vi.stubGlobal('fetch', fetchMock);
    keyring.deletePassword.mockReset().mockReturnValue(true);
    keyring.getPassword.mockReset().mockReturnValue('session-token-1');
    fetchMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    writeUserConfig({ apiUrl: API_URL, sessionId: 'session-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(configHomePath, { force: true, recursive: true });
  });

  it('should revoke the session and clear the keyring and config.json', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: true }));

    await logoutCommand.action({}, undefined);

    const [revokeRequest] = readRequests();
    expect(revokeRequest?.url).toBe(`${API_URL}/v1/auth/revoke-session`);
    expect(revokeRequest?.headers.get('Authorization')).toBe(
      'Bearer session-token-1',
    );
    expect(await revokeRequest?.json()).toEqual({ token: 'session-token-1' });
    expect(keyring.deletePassword).toHaveBeenCalled();
    expect(readUserConfig()).toEqual({ apiUrl: API_URL });
    expect(console.log).toHaveBeenCalledWith('Logged out.');
  });

  it('should revoke the token without its signature when the bearer is signed', async () => {
    keyring.getPassword.mockReturnValue('session-token-1.c2lnbmF0dXJl');
    fetchMock.mockResolvedValueOnce(Response.json({ status: true }));

    await logoutCommand.action({}, undefined);

    expect(await readRequests()[0]?.json()).toEqual({
      token: 'session-token-1',
    });
  });

  it('should clear both stores when the session already ended', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          code: 'E_UNAUTHENTICATED',
          details: null,
          message: 'The bearer token is missing, invalid or expired.',
        },
        { status: 401 },
      ),
    );

    await logoutCommand.action({}, undefined);

    expect(keyring.deletePassword).toHaveBeenCalled();
    expect(readUserConfig()).toEqual({ apiUrl: API_URL });
  });

  it('should keep both stores when the revocation fails', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 'E_INTERNAL', details: null, message: 'Something went wrong.' },
        { status: 500 },
      ),
    );

    await expect(logoutCommand.action({}, undefined)).rejects.toMatchObject({
      code: 'E_INTERNAL',
    });
    expect(keyring.deletePassword).not.toHaveBeenCalled();
    expect(readUserConfig()).toEqual({
      apiUrl: API_URL,
      sessionId: 'session-1',
    });
  });

  it('should print an empty object when --json is passed', async () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    fetchMock.mockResolvedValueOnce(Response.json({ status: true }));

    await logoutCommand.action({ json: true }, undefined);

    expect(stdoutWrite).toHaveBeenCalledWith('{}\n');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('should throw E_NOT_LOGGED_IN when no token is stored', async () => {
    keyring.getPassword.mockReturnValue(null);

    await expect(logoutCommand.action({}, undefined)).rejects.toThrow(
      NotLoggedInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
