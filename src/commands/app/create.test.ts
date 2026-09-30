import { select, text } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import {
  ACME_ORGANIZATION,
  DEMO_APP,
  GLOBEX_ORGANIZATION,
} from '../../../test/fixtures.js';
import { MissingParameterError } from '../../utils/errors.js';
import appCreateCommand from './create.js';

vi.mock('@clack/prompts');

describe('app create', () => {
  const harness = useCommandHarness();

  function respondWithCreatedApp(organizationId: string): void {
    harness.routes[`POST /v1/organizations/${organizationId}/apps`] = () =>
      Response.json(DEMO_APP, { status: 201 });
  }

  it("should create the app in the user's only organization", async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION]);
    respondWithCreatedApp(ACME_ORGANIZATION.id);

    await appCreateCommand.action(
      { framework: 'capacitor', name: 'Demo' },
      undefined,
    );

    expect(await harness.requests.at(-1)?.json()).toEqual({
      framework: 'capacitor',
      name: 'Demo',
    });
    expect(harness.requests.at(-1)?.headers.get('Idempotency-Key')).toEqual(
      expect.any(String),
    );
    expect(harness.readLines()).toEqual([`Created app Demo (${DEMO_APP.id}).`]);
  });

  it('should create the app in the organization --organization names and print it as JSON', async () => {
    harness.routes['GET /v1/organizations'] = () =>
      Response.json([ACME_ORGANIZATION, GLOBEX_ORGANIZATION]);
    respondWithCreatedApp(GLOBEX_ORGANIZATION.id);

    await appCreateCommand.action(
      {
        framework: 'expo',
        json: true,
        name: 'Demo',
        organization: 'Globex',
      },
      undefined,
    );

    expect(harness.readJson()).toEqual(DEMO_APP);
  });

  it('should ask for the name and the framework when interactive and they are missing', async () => {
    stubInteractiveTerminal();
    vi.mocked(text).mockResolvedValue('Demo');
    vi.mocked(select).mockResolvedValue('react-native');
    respondWithCreatedApp(ACME_ORGANIZATION.id);

    await appCreateCommand.action(
      { organization: ACME_ORGANIZATION.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which framework does the app use?',
      options: [
        { label: 'capacitor', value: 'capacitor' },
        { label: 'cordova', value: 'cordova' },
        { label: 'expo', value: 'expo' },
        { label: 'react-native', value: 'react-native' },
      ],
    });
    expect(await harness.requests[0]?.json()).toEqual({
      framework: 'react-native',
      name: 'Demo',
    });
  });

  it('should throw E_MISSING_PARAMETER naming --framework when it is missing and nobody can be asked', async () => {
    await expect(
      appCreateCommand.action(
        { name: 'Demo', organization: ACME_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new MissingParameterError('--framework'));
    expect(harness.requests).toEqual([]);
  });
});
