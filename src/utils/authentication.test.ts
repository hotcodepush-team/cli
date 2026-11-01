import { describe, expect, it, vi } from 'vitest';
import {
  API_URL,
  respondWithApiError,
  stubInteractiveTerminal,
  TOKEN,
  useCommandHarness,
  useStoredSession,
} from '../../test/command-harness.js';
import { ensureAuthentication, readSessionState } from './authentication.js';
import { NotLoggedInError } from './errors.js';
import { logIn } from './login.js';
import { promptYesNo } from './prompts.js';
import { readUserConfig, writeUserConfig } from './user-config.js';

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
vi.mock('./login.js', () => ({ logIn: vi.fn() }));
vi.mock('./prompts.js', () => ({ promptYesNo: vi.fn() }));

const FUTURE_EXPIRY = '2099-01-01T00:00:00.000Z';

const PAST_EXPIRY = '2000-01-01T00:00:00.000Z';

const SESSION_PATH = '/v1/auth/get-session';

const USER = { email: 'anna@example.com', id: 'user-1', name: 'Anna Example' };

function writeSessionExpiresAt(sessionExpiresAt: string): void {
  writeUserConfig({ ...readUserConfig(), sessionExpiresAt });
}

describe('readSessionState', () => {
  const harness = useCommandHarness();

  it('should answer usable without a request when HOTCODEPUSH_TOKEN is set, even with a past stored expiry', async () => {
    writeUserConfig({ ...readUserConfig(), token: 'stored-token-1' });
    writeSessionExpiresAt(PAST_EXPIRY);

    expect(await readSessionState()).toBe('usable');
    expect(harness.requests).toEqual([]);
  });

  it('should answer missing without a request when no token is stored', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');

    expect(await readSessionState()).toBe('missing');
    expect(harness.requests).toEqual([]);
  });

  it('should answer usable without a request when the stored expiry is in the future', async () => {
    useStoredSession();
    writeSessionExpiresAt(FUTURE_EXPIRY);

    expect(await readSessionState()).toBe('usable');
    expect(harness.requests).toEqual([]);
  });

  it('should store the renewed expiry and answer usable when the API still knows a session past its stored expiry', async () => {
    useStoredSession();
    writeSessionExpiresAt(PAST_EXPIRY);
    harness.routes[`GET ${SESSION_PATH}`] = () =>
      Response.json({
        session: { expiresAt: FUTURE_EXPIRY, id: 'session-2', userId: USER.id },
        user: USER,
      });

    expect(await readSessionState()).toBe('usable');
    const [sessionRequest] = harness.requests;
    expect(sessionRequest?.url).toBe(`${API_URL}${SESSION_PATH}`);
    expect(sessionRequest?.headers.get('Authorization')).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(readUserConfig()).toMatchObject({
      sessionExpiresAt: FUTURE_EXPIRY,
      sessionId: 'session-2',
    });
  });

  it('should answer expired when the API refuses a session past its stored expiry', async () => {
    useStoredSession();
    writeSessionExpiresAt(PAST_EXPIRY);
    harness.routes[`GET ${SESSION_PATH}`] = () =>
      respondWithApiError(
        401,
        'unauthenticated',
        'The bearer token is missing, invalid or expired.',
      );

    expect(await readSessionState()).toBe('expired');
  });
});

describe('ensureAuthentication', () => {
  const harness = useCommandHarness();

  it('should throw `not_logged_in` and ask nothing when not interactive and no token exists', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');

    await expect(ensureAuthentication({})).rejects.toThrow(NotLoggedInError);
    expect(promptYesNo).not.toHaveBeenCalled();
  });

  it('should return without a request when not interactive and a stored token is past its expiry', async () => {
    useStoredSession();
    writeSessionExpiresAt(PAST_EXPIRY);

    await ensureAuthentication({});

    expect(harness.requests).toEqual([]);
    expect(promptYesNo).not.toHaveBeenCalled();
  });

  it('should ask nothing when interactive and the session is usable', async () => {
    stubInteractiveTerminal();

    await ensureAuthentication({});

    expect(promptYesNo).not.toHaveBeenCalled();
  });

  it('should throw `not_logged_in` when interactive and the login is declined', async () => {
    stubInteractiveTerminal();
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');
    vi.mocked(promptYesNo).mockResolvedValue(false);

    await expect(ensureAuthentication({})).rejects.toThrow(NotLoggedInError);
    expect(harness.readDiagnostics()).toBe('You are not logged in.\n');
    expect(logIn).not.toHaveBeenCalled();
  });

  it('should log in and name the user when interactive and the login is accepted', async () => {
    stubInteractiveTerminal();
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');
    vi.mocked(promptYesNo).mockResolvedValue(true);
    vi.mocked(logIn).mockResolvedValue(USER);

    await ensureAuthentication({});

    expect(logIn).toHaveBeenCalledWith({});
    expect(harness.readDiagnostics()).toBe(
      'You are not logged in.\nLogged in as Anna Example (anna@example.com).\n',
    );
  });

  it('should warn that the session has expired when interactive and the API refuses the stored session', async () => {
    stubInteractiveTerminal();
    useStoredSession();
    writeSessionExpiresAt(PAST_EXPIRY);
    harness.routes[`GET ${SESSION_PATH}`] = () =>
      respondWithApiError(
        401,
        'unauthenticated',
        'The bearer token is missing, invalid or expired.',
      );
    vi.mocked(promptYesNo).mockResolvedValue(false);

    await expect(ensureAuthentication({})).rejects.toThrow(NotLoggedInError);
    expect(harness.readDiagnostics()).toBe('Your session has expired.\n');
  });
});
