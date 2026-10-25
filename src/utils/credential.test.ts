import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../test/command-harness.js';
import { RUNNER_USER } from '../../test/fixtures.js';
import {
  fetchCurrentUser,
  isUnauthenticatedError,
  resolveCredentialText,
} from './credential.js';
import { NotLoggedInError } from './errors.js';

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn(function () {
    return { getPassword: () => null };
  }),
}));

describe('credential', () => {
  const harness = useCommandHarness();

  it('should read the user behind the bearer from the API', async () => {
    harness.routes['GET /v1/users/me'] = () => Response.json(RUNNER_USER);

    expect(await fetchCurrentUser()).toEqual(RUNNER_USER);
  });

  it('should say logged in for the stored session', () => {
    expect(resolveCredentialText(RUNNER_USER, false)).toBe(
      'Logged in as Anna Example (anna@example.com).',
    );
  });

  it('should name HOTCODEPUSH_TOKEN when the token variable authenticates', () => {
    expect(resolveCredentialText(RUNNER_USER, true)).toBe(
      'Authenticated with HOTCODEPUSH_TOKEN as Anna Example (anna@example.com).',
    );
  });

  it("should pass the API's refusal of the bearer through, and tell it apart from other failures", async () => {
    harness.routes['GET /v1/users/me'] = () =>
      respondWithApiError(401, 'unauthenticated', 'The bearer is invalid.');

    const error: unknown = await fetchCurrentUser().catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(isUnauthenticatedError(error)).toBe(true);
    expect(isUnauthenticatedError(new Error('fetch failed'))).toBe(false);
  });

  it('should be not logged in without a token, before any request', async () => {
    vi.stubEnv('HOTCODEPUSH_TOKEN', '');

    await expect(fetchCurrentUser()).rejects.toBeInstanceOf(NotLoggedInError);
    expect(harness.requests).toEqual([]);
  });
});
