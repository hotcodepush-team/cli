import { describe, expect, it } from 'vitest';
import { useCommandHarness } from '../../../test/command-harness.js';
import { ACME_ORGANIZATION } from '../../../test/fixtures.js';
import checkoutCreateCommand from './create.js';

const CHECKOUT = { url: 'https://checkout.example.com/c/acme-1' };

const CHECKOUTS_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/checkouts`;

describe('checkout create', () => {
  const harness = useCommandHarness();

  function respondWithCheckout(): void {
    harness.routes[`POST ${CHECKOUTS_PATH}`] = () =>
      Response.json(CHECKOUT, { status: 201 });
  }

  it('should create the checkout and print its URL to open', async () => {
    respondWithCheckout();

    await checkoutCreateCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      `Open the checkout to enable billing: ${CHECKOUT.url}`,
    ]);
  });

  it("should print the API's checkout as JSON when --json is passed", async () => {
    respondWithCheckout();

    await checkoutCreateCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readJson()).toEqual(CHECKOUT);
  });
});
