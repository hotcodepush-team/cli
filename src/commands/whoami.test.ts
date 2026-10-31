import { describe, expect, it, vi } from 'vitest';
import {
  API_URL,
  respondWithApiError,
  TOKEN,
  useCommandHarness,
  useStoredSession,
} from '../../test/command-harness.js';
import { RUNNER_USER } from '../../test/fixtures.js';
import { PACKAGE_JSON } from '../config/consts.js';
import { runCli } from '../utils/cli.js';
import { NotLoggedInError } from '../utils/errors.js';
import { writeUserConfig } from '../utils/user-config.js';
import whoamiCommand from './whoami.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

const USER_PATH = '/v1/users/me';

describe('whoami', () => {
  const harness = useCommandHarness();

  function respondWithSessionAndUser(): void {
    useStoredSession();
    harness.routes[`GET ${USER_PATH}`] = () => Response.json(RUNNER_USER);
  }

  it('should print the user and the API, in one request', async () => {
    respondWithSessionAndUser();

    await whoamiCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'Logged in as Anna Example (anna@example.com).',
      `API: ${API_URL}`,
    ]);
    expect(
      harness.requests.map(request => request.headers.get('Authorization')),
    ).toEqual(['Bearer session-token-1']);
  });

  it('should print the API URL and the user as served when --json is passed', async () => {
    respondWithSessionAndUser();

    await whoamiCommand.action({ json: true }, undefined);

    expect(harness.readJson()).toEqual({
      apiUrl: API_URL,
      user: RUNNER_USER,
    });
    expect(harness.readLines()).toEqual([]);
  });

  it('should leave the API out when it is the default one', async () => {
    writeUserConfig({});
    respondWithSessionAndUser();

    await whoamiCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'Logged in as Anna Example (anna@example.com).',
    ]);
  });

  it('should print the user HOTCODEPUSH_TOKEN stands for when the variable authenticates', async () => {
    respondWithSessionAndUser();
    vi.stubEnv('HOTCODEPUSH_TOKEN', TOKEN);

    await whoamiCommand.action({}, undefined);

    expect(harness.readLines()[0]).toBe(
      'Authenticated with HOTCODEPUSH_TOKEN as Anna Example (anna@example.com).',
    );
  });

  it('should throw `not_logged_in` when no token exists', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);

    await expect(whoamiCommand.action({}, undefined)).rejects.toThrow(
      NotLoggedInError,
    );
    expect(harness.requests).toEqual([]);
  });

  it("should pass the API's `unauthenticated` error through and exit 3 when the token no longer counts", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    useStoredSession();
    harness.routes[`GET ${USER_PATH}`] = () =>
      respondWithApiError(
        401,
        'unauthenticated',
        'The bearer token is missing, invalid or expired; sign in again or create a new token.',
      );

    const exitCode = await runCli(
      { whoami: () => import('./whoami.js') },
      ['whoami'],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(3);
    expect(stderrWrite).toHaveBeenCalledWith(
      'The bearer token is missing, invalid or expired; sign in again or create a new token.\nhttps://hotcodepush.com/docs/cli/errors#unauthenticated\n',
    );
  });
});
