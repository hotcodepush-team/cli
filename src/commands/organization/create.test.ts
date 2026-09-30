import { text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  respondWithApiError,
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { ACME_ORGANIZATION } from '../../../test/fixtures.js';
import { PACKAGE_JSON } from '../../config/consts.js';
import { runCli } from '../../utils/cli.js';
import { MissingParameterError } from '../../utils/errors.js';
import organizationCreateCommand from './create.js';

vi.mock('@clack/prompts');

describe('organization create', () => {
  const harness = useCommandHarness();

  function respondWithCreatedOrganization(): void {
    harness.routes['POST /v1/organizations'] = () =>
      Response.json(ACME_ORGANIZATION, { status: 201 });
  }

  it('should create the organization and print its name and id', async () => {
    respondWithCreatedOrganization();

    await organizationCreateCommand.action({ name: 'Acme' }, undefined);

    const [request] = harness.requests;
    expect(await request?.json()).toEqual({ name: 'Acme' });
    expect(request?.headers.get('Authorization')).toBe(
      'Bearer session-token-1',
    );
    expect(request?.headers.get('X-HotCodePush-Client')).toBe('cli/0.0.0');
    expect(harness.readLines()).toEqual([
      `Created organization Acme (${ACME_ORGANIZATION.id}).`,
    ]);
  });

  it('should print the organization as JSON when --json is passed', async () => {
    respondWithCreatedOrganization();

    await organizationCreateCommand.action(
      { json: true, name: 'Acme' },
      undefined,
    );

    expect(harness.readJson()).toEqual(ACME_ORGANIZATION);
    expect(harness.readLines()).toEqual([]);
  });

  it('should ask for the name when interactive and --name is missing', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('Acme');
    respondWithCreatedOrganization();

    await organizationCreateCommand.action({}, undefined);

    expect(await harness.requests[0]?.json()).toEqual({ name: 'Acme' });
  });

  it('should throw E_MISSING_PARAMETER when --name is missing and nobody can be asked', async () => {
    await expect(
      organizationCreateCommand.action({}, undefined),
    ).rejects.toThrow(MissingParameterError);
    expect(harness.requests).toEqual([]);
  });

  it("should pass the API's error through with its code in front", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    harness.routes['POST /v1/organizations'] = () =>
      respondWithApiError(
        400,
        'E_VALIDATION',
        'The json field name is invalid: Too small.',
      );

    const exitCode = await runCli(
      { 'organization create': () => import('./create.js') },
      ['organization', 'create', '--name', ' '],
      PACKAGE_JSON,
    );

    expect(exitCode).toBe(1);
    expect(stderrWrite).toHaveBeenCalledWith(
      'E_VALIDATION The json field name is invalid: Too small. https://hotcodepush.com/docs/cli/errors#E_VALIDATION\n',
    );
  });
});
