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

const SESSION = {
  session: { id: 'session-1', userId: 'user-1' },
  user: { email: 'anna@example.com', id: 'user-1', name: 'Anna Example' },
};

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

  it('should revoke the session and clear the keyring and config.json, naming who was logged out', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(SESSION))
      .mockResolvedValueOnce(Response.json({ status: true }));

    await logoutCommand.action({}, undefined);

    const [sessionRequest, revokeRequest] = readRequests();
    expect(sessionRequest?.url).toBe(`${API_URL}/v1/auth/get-session`);
    expect(revokeRequest?.url).toBe(`${API_URL}/v1/auth/revoke-session`);
    expect(revokeRequest?.headers.get('Authorization')).toBe(
      'Bearer session-token-1',
    );
    expect(await revokeRequest?.json()).toEqual({ token: 'session-token-1' });
    expect(keyring.deletePassword).toHaveBeenCalled();
    expect(readUserConfig()).toEqual({ apiUrl: API_URL });
    expect(console.log).toHaveBeenCalledWith('Logged out Anna Example.');
  });

  it('should revoke the token without its signature when the bearer is signed', async () => {
    keyring.getPassword.mockReturnValue('session-token-1.c2lnbmF0dXJl');
    fetchMock
      .mockResolvedValueOnce(Response.json(SESSION))
      .mockResolvedValueOnce(Response.json({ status: true }));

    await logoutCommand.action({}, undefined);

    expect(await readRequests()[1]?.json()).toEqual({
      token: 'session-token-1',
    });
  });

  it('should clear both stores when the session already ended', async () => {
    const unauthenticated = () =>
      Response.json(
        {
          code: 'E_UNAUTHENTICATED',
          details: null,
          message: 'The bearer token is missing, invalid or expired.',
        },
        { status: 401 },
      );
    fetchMock
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(unauthenticated());

    await logoutCommand.action({}, undefined);

    expect(keyring.deletePassword).toHaveBeenCalled();
    expect(readUserConfig()).toEqual({ apiUrl: API_URL });
    expect(console.log).toHaveBeenCalledWith('Logged out.');
  });

  it('should keep both stores when the revocation fails', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(SESSION))
      .mockResolvedValueOnce(
        Response.json(
          {
            code: 'E_INTERNAL',
            details: null,
            message: 'Something went wrong.',
          },
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

  it('should print the id and the name of the ended session when --json is passed', async () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    fetchMock
      .mockResolvedValueOnce(Response.json(SESSION))
      .mockResolvedValueOnce(Response.json({ status: true }));

    await logoutCommand.action({ json: true }, undefined);

    expect(stdoutWrite).toHaveBeenCalledWith(
      '{\n  "id": "session-1",\n  "name": "Anna Example"\n}\n',
    );
    expect(console.log).not.toHaveBeenCalled();
  });

  it('should revoke the stored session, not HOTCODEPUSH_TOKEN, and say the variable still authenticates', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', 'hcp_api_token');
    fetchMock
      .mockResolvedValueOnce(Response.json(SESSION))
      .mockResolvedValueOnce(Response.json({ status: true }));

    await logoutCommand.action({}, undefined);

    const [, revokeRequest] = readRequests();
    expect(revokeRequest?.headers.get('Authorization')).toBe(
      'Bearer session-token-1',
    );
    expect(await revokeRequest?.json()).toEqual({ token: 'session-token-1' });
    expect(keyring.deletePassword).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      'Logged out Anna Example. HOTCODEPUSH_TOKEN still authenticates.',
    );
  });

  it('should end nothing when only HOTCODEPUSH_TOKEN is set, and say so', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', 'hcp_api_token');
    keyring.getPassword.mockReturnValue(null);

    await logoutCommand.action({}, undefined);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(keyring.deletePassword).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      'No stored session to end. HOTCODEPUSH_TOKEN still authenticates.',
    );
  });

  it('should throw E_NOT_LOGGED_IN when no token is stored', async () => {
    keyring.getPassword.mockReturnValue(null);

    await expect(logoutCommand.action({}, undefined)).rejects.toThrow(
      NotLoggedInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
