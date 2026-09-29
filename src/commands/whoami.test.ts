import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACKAGE_JSON } from '../config/consts.js';
import { runCli } from '../utils/cli.js';
import { NotLoggedInError } from '../utils/errors.js';
import { writeUserConfig } from '../utils/user-config.js';
import whoamiCommand from './whoami.js';

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

const DEFAULT_RESPONSES: Record<string, () => Response> = {
  '/v1/auth/get-session': () =>
    Response.json({
      session: { id: 'session-1', userId: 'user-1' },
      user: { email: 'anna@example.com', id: 'user-1', name: 'Anna Example' },
    }),
  '/v1/auth/organization/get-active-member-role?organizationId=organization-1':
    () => Response.json({ role: 'owner' }),
  '/v1/auth/organization/get-active-member-role?organizationId=organization-2':
    () => Response.json({ role: 'member' }),
  '/v1/auth/organization/list': () =>
    Response.json([
      { id: 'organization-1', name: 'Acme', slug: 'acme' },
      { id: 'organization-2', name: 'Globex', slug: 'globex' },
    ]),
};

describe('whoami', () => {
  let configHomePath: string;
  let responses: Record<string, () => Response>;
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
    keyring.getPassword.mockReset().mockReturnValue('session-token-1');
    responses = { ...DEFAULT_RESPONSES };
    fetchMock.mockReset().mockImplementation(async (input, init) => {
      const url = new URL(new Request(input, init).url);
      const respond = responses[`${url.pathname}${url.search}`];
      return respond ? respond() : new Response(null, { status: 404 });
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    writeUserConfig({ apiUrl: API_URL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(configHomePath, { force: true, recursive: true });
  });

  it('should print the user and their organizations with their roles', async () => {
    await whoamiCommand.action({}, undefined);

    expect(vi.mocked(console.log).mock.calls).toEqual([
      ['Logged in as Anna Example (anna@example.com).'],
      ['Organizations:'],
      ['  Acme (owner)'],
      ['  Globex (member)'],
    ]);
    expect(
      readRequests().map(request => request.headers.get('Authorization')),
    ).toEqual(Array(4).fill('Bearer session-token-1'));
  });

  it('should print the user and their organizations as JSON when --json is passed', async () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    await whoamiCommand.action({ json: true }, undefined);

    expect(
      JSON.parse(stdoutWrite.mock.calls.map(([chunk]) => chunk).join('')),
    ).toEqual({
      organizations: [
        { id: 'organization-1', name: 'Acme', role: 'owner' },
        { id: 'organization-2', name: 'Globex', role: 'member' },
      ],
      user: { email: 'anna@example.com', id: 'user-1', name: 'Anna Example' },
    });
    expect(console.log).not.toHaveBeenCalled();
  });

  it('should say so when the user belongs to no organization', async () => {
    responses['/v1/auth/organization/list'] = () => Response.json([]);

    await whoamiCommand.action({}, undefined);

    expect(console.log).toHaveBeenLastCalledWith('Organizations: none yet.');
  });

  it('should send HOTCODEPUSH_TOKEN before the stored token when it is set', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', 'environment-token');

    await whoamiCommand.action({}, undefined);

    expect(readRequests()[0]?.headers.get('Authorization')).toBe(
      'Bearer environment-token',
    );
  });

  it('should throw E_NOT_LOGGED_IN when no token exists', async () => {
    keyring.getPassword.mockReturnValue(null);

    await expect(whoamiCommand.action({}, undefined)).rejects.toThrow(
      NotLoggedInError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should pass the API's E_UNAUTHENTICATED through and exit 3 when the token no longer counts", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          code: 'E_UNAUTHENTICATED',
          details: null,
          message:
            'The bearer token is missing, invalid or expired; sign in again or create a new token.',
        },
        { status: 401 },
      ),
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
