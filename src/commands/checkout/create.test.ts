import { text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION } from '../../../test/fixtures.js';
import checkoutCreateCommand from './create.js';

vi.mock('@clack/prompts');

const CHECKOUT = { url: 'https://checkout.example.com/c/acme-1' };

const CHECKOUTS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/checkouts`;

describe('checkout create', () => {
  const harness = useCommandHarness();

  async function readCreateBody(): Promise<unknown> {
    const createRequest = harness.requests.find(
      ({ method }) => method === 'POST',
    );
    return createRequest?.json();
  }

  function respondWithCheckout(): void {
    harness.routes[`POST ${CHECKOUTS_PATH}`] = () =>
      Response.json(CHECKOUT, { status: 201 });
  }

  it('should create the checkout with the cap in cents and print its URL to open', async () => {
    respondWithCheckout();

    await checkoutCreateCommand.action(
      { organization: ACME_ORGANIZATION.id, spendingCap: 50 },
      undefined,
    );

    expect(await readCreateBody()).toEqual({ spendingCapCents: 5000 });
    expect(harness.readLines()).toEqual([
      `Open the checkout to enable billing: ${CHECKOUT.url}`,
    ]);
  });

  it("should print the API's checkout as JSON when --json is passed", async () => {
    respondWithCheckout();

    await checkoutCreateCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id, spendingCap: 50 },
      undefined,
    );

    expect(harness.readJson()).toEqual(CHECKOUT);
  });

  it('should ask for the cap in whole dollars when --spending-cap is missing and someone can answer', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('25');
    respondWithCheckout();

    await checkoutCreateCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(await readCreateBody()).toEqual({ spendingCapCents: 2500 });
  });

  it('should name the flag with E_MISSING_PARAMETER and create nothing when it is missing and nobody can answer', async () => {
    respondWithCheckout();

    await expect(
      checkoutCreateCommand.action(
        { json: true, organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      message: '--spending-cap is missing',
    });
    expect(harness.requests).toEqual([]);
  });
});
