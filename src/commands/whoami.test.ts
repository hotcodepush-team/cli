import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  GLOBEX_ORGANIZATION,
  RUNNER_USER,
} from '../../test/fixtures.js';
import { PACKAGE_JSON } from '../config/consts.js';
import { runCli } from '../utils/cli.js';
import { NotLoggedInError } from '../utils/errors.js';
import whoamiCommand from './whoami.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

describe('whoami', () => {
  const harness = useCommandHarness();

  function respondWithSessionAndOrganizations(organizations: object[]): void {
    harness.routes['GET /v1/users/me'] = () => Response.json(RUNNER_USER);
    harness.routes['GET /v1/organizations?limit=100&offset=0'] = () =>
      Response.json(organizations);
  }

  it('should print the user and their organizations with their roles', async () => {
    respondWithSessionAndOrganizations([
      ACME_ORGANIZATION,
      GLOBEX_ORGANIZATION,
    ]);

    await whoamiCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      'Logged in as Anna Example (anna@example.com).',
      'Organizations:',
      '  Acme (owner)',
      '  Globex (admin)',
    ]);
    expect(
      harness.requests.map(request => request.headers.get('Authorization')),
    ).toEqual(['Bearer session-token-1', 'Bearer session-token-1']);
  });

  it('should print the user and their organizations as JSON when --json is passed', async () => {
    respondWithSessionAndOrganizations([
      ACME_ORGANIZATION,
      GLOBEX_ORGANIZATION,
    ]);

    await whoamiCommand.action({ json: true }, undefined);

    expect(harness.readJson()).toEqual({
      organizations: [
        { id: ACME_ORGANIZATION.id, name: 'Acme', role: 'owner' },
        { id: GLOBEX_ORGANIZATION.id, name: 'Globex', role: 'admin' },
      ],
      user: RUNNER_USER,
    });
    expect(harness.readLines()).toEqual([]);
  });

  it('should print the user HOTCODEPUSH_TOKEN stands for, as the API names the credential', async () => {
    respondWithSessionAndOrganizations([ACME_ORGANIZATION]);
    harness.routes['GET /v1/users/me'] = () =>
      Response.json({ ...RUNNER_USER, credential: 'token' });

    await whoamiCommand.action({}, undefined);

    expect(harness.readLines()[0]).toBe(
      'Authenticated with HOTCODEPUSH_TOKEN as Anna Example (anna@example.com).',
    );
  });

  it('should say so when the user belongs to no organization', async () => {
    respondWithSessionAndOrganizations([]);

    await whoamiCommand.action({}, undefined);

    expect(harness.readLines().at(-1)).toBe('Organizations: none yet.');
  });

  it('should throw E_NOT_LOGGED_IN when no token exists', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', undefined);

    await expect(whoamiCommand.action({}, undefined)).rejects.toThrow(
      NotLoggedInError,
    );
    expect(harness.requests).toEqual([]);
  });

  it("should pass the API's E_UNAUTHENTICATED through and exit 3 when the token no longer counts", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    respondWithSessionAndOrganizations([]);
    harness.routes['GET /v1/users/me'] = () =>
      respondWithApiError(
        401,
        'E_UNAUTHENTICATED',
        'The bearer token is missing, invalid or expired; sign in again or create a new token.',
      );

    const exitCode = await runCli(
      { whoami: () => import('./whoami.js') },
      ['whoami'],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(3);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_UNAUTHENTICATED The bearer token is missing, invalid or expired; sign in again or create a new token. https://hotcodepush.com/docs/cli/errors#E_UNAUTHENTICATED\n',
    );
  });
});
