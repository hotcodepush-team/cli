import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import customerPortalSessionCreateCommand from './create.js';

const CUSTOMER_PORTAL_SESSION = {
  url: 'https://portal.example.com/p/globex-1',
};

const CUSTOMER_PORTAL_SESSIONS_PATH = `/v1/organizations/${GLOBEX_ORGANIZATION.id}/customer-portal-sessions`;

describe('customer-portal-session create', () => {
  const harness = useCommandHarness();

  function respondWithCustomerPortalSession(): void {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([GLOBEX_ORGANIZATION]);
    harness.routes[`POST ${CUSTOMER_PORTAL_SESSIONS_PATH}`] = () =>
      Response.json(CUSTOMER_PORTAL_SESSION, { status: 201 });
  }

  it("should create a session for the user's only organization and print its URL to open", async () => {
    respondWithCustomerPortalSession();

    await customerPortalSessionCreateCommand.action({}, undefined);

    expect(harness.readLines()).toEqual([
      `Open the customer portal for the invoices and the payment method: ${CUSTOMER_PORTAL_SESSION.url}`,
    ]);
  });

  it("should print the API's session as JSON when --json is passed", async () => {
    respondWithCustomerPortalSession();

    await customerPortalSessionCreateCommand.action(
      { json: true, organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(CUSTOMER_PORTAL_SESSION);
  });

  it("should pass the API's E_VALIDATION through when the organization never subscribed", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    harness.routes[`POST ${CUSTOMER_PORTAL_SESSIONS_PATH}`] = () =>
      respondWithApiError(
        400,
        'E_VALIDATION',
        'The organization has no subscription, so it has no customer portal.',
      );

    const exitCode = await runCli(
      {
        'customer-portal-session create': () => import('./create.js'),
      },
      [
        'customer-portal-session',
        'create',
        '--organization',
        GLOBEX_ORGANIZATION.id,
      ],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_VALIDATION The organization has no subscription, so it has no customer portal. https://hotcodepush.com/docs/cli/errors#E_VALIDATION\n',
    );
  });
});
