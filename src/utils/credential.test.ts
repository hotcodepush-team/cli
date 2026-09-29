import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  useCommandHarness,
} from '../testing/command-harness.js';
import { ACME_ORGANIZATION } from '../testing/fixtures.js';
import { fetchCredential } from './credential.js';
import { NotLoggedInError } from './errors.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

describe('credential', () => {
  const harness = useCommandHarness();

  it('should name the session user when the token has a session', async () => {
    harness.routes['GET /v1/auth/get-session'] = () =>
      Response.json({
        session: { id: 'session-1', userId: 'user-1' },
        user: { email: 'anna@example.com', id: 'user-1', name: 'Anna Example' },
      });

    expect(await fetchCredential()).toEqual({
      description: 'logged in as Anna Example (anna@example.com)',
      kind: 'session',
    });
  });

  it('should accept HOTCODEPUSH_TOKEN as an API token when no session answers for it but the API does', async () => {
    harness.routes['GET /v1/auth/get-session'] = () => Response.json(null);
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);

    expect(await fetchCredential()).toEqual({
      description: 'authenticated with HOTCODEPUSH_TOKEN',
      kind: 'token',
    });
    expect(
      harness.requests.find(({ url }) => url.includes('/v1/organizations'))
        ?.url,
    ).toBe('https://api.example.com/v1/organizations?limit=1');
  });

  it('should be not logged in when the API refuses the token', async () => {
    harness.routes['GET /v1/auth/get-session'] = () => Response.json(null);
    harness.routes['GET /v1/organizations'] = () =>
      respondWithApiError(401, 'E_UNAUTHENTICATED', 'The bearer is invalid.');

    await expect(fetchCredential()).rejects.toBeInstanceOf(NotLoggedInError);
  });

  it('should be not logged in without a token', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');

    await expect(fetchCredential()).rejects.toBeInstanceOf(NotLoggedInError);
    expect(harness.requests).toEqual([]);
  });
});
