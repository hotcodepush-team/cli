import { confirm } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION, SSO_PROVIDER } from '../../../test/fixtures.js';
import { ConfirmationRequiredError } from '../../utils/errors.js';
import ssoProviderDeleteCommand from './delete.js';

vi.mock('@clack/prompts');

const SSO_PROVIDER_PATH = `/v1/organizations/${ACME_ORGANIZATION.id}/sso-provider`;

const CONSEQUENCE =
  'deletes the SSO provider for example.com: password sign-in works again for its members and the domain is forgotten';

describe('sso-provider delete', () => {
  const harness = useCommandHarness();

  function readDeleteRequests(): Request[] {
    return harness.requests.filter(({ method }) => method === 'DELETE');
  }

  function respondWithProvider(): void {
    harness.routes[`GET ${SSO_PROVIDER_PATH}`] = () =>
      Response.json(SSO_PROVIDER);
    harness.routes[`DELETE ${SSO_PROVIDER_PATH}`] = () =>
      new Response(null, { status: 204 });
  }

  it('should delete the provider once confirmed, stating that password sign-in works again and the domain is forgotten', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(true);
    respondWithProvider();

    await ssoProviderDeleteCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(confirm).toHaveBeenCalledWith({
      initialValue: false,
      message: `This ${CONSEQUENCE}. Continue?`,
    });
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readLines()).toEqual([
      `Deleted the SSO provider for example.com (${SSO_PROVIDER.id}).`,
    ]);
  });

  it('should delete nothing when the confirmation is declined', async () => {
    stubInteractiveTerminal();
    vi.mocked(confirm).mockResolvedValue(false);
    respondWithProvider();

    await ssoProviderDeleteCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(readDeleteRequests()).toEqual([]);
  });

  it('should delete without asking and print the id and domain of what went when --yes and --json are passed', async () => {
    respondWithProvider();

    await ssoProviderDeleteCommand.action(
      { json: true, organization: ACME_ORGANIZATION.id, yes: true },
      undefined,
    );

    expect(confirm).not.toHaveBeenCalled();
    expect(readDeleteRequests()).toHaveLength(1);
    expect(harness.readJson()).toEqual({
      id: SSO_PROVIDER.id,
      name: 'example.com',
    });
  });

  it('should throw E_CONFIRMATION_REQUIRED with the consequence and delete nothing when nobody can be asked', async () => {
    respondWithProvider();

    await expect(
      ssoProviderDeleteCommand.action(
        { json: true, organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new ConfirmationRequiredError(CONSEQUENCE));
    expect(readDeleteRequests()).toEqual([]);
  });
});
