import { select } from '@clack/prompts';
import { describe, expect, it, vi } from 'vitest';
import {
  stubInteractiveTerminal,
  useCommandHarness,
} from '../../../test/command-harness.js';
import { GLOBEX_LIMITS, GLOBEX_ORGANIZATION } from '../../../test/fixtures.js';
import { MissingParameterError, UnknownNameError } from '../../utils/errors.js';
import limitGetCommand from './get.js';

vi.mock('@clack/prompts');

describe('limit get', () => {
  const harness = useCommandHarness();

  function respondWithLimits(): void {
    harness.routes[`GET /v1/organizations/${GLOBEX_ORGANIZATION.id}/limits`] =
      () => Response.json(GLOBEX_LIMITS);
  }

  it('should print the limit --limit names with its value, its default and whether it is overridden', async () => {
    respondWithLimits();

    await limitGetCommand.action(
      { limit: 'appCountLimit', organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(harness.readLines()).toEqual([
      'Limit       appCountLimit',
      'Value       25',
      'Default     10',
      'Overridden  yes',
    ]);
  });

  it('should print the limit keyed by its name as the API answers it when --json is passed', async () => {
    respondWithLimits();

    await limitGetCommand.action(
      {
        json: true,
        limit: 'memberCountLimit',
        organization: GLOBEX_ORGANIZATION.id,
      },
      undefined,
    );

    expect(harness.readJson()).toEqual({
      memberCountLimit: GLOBEX_LIMITS.memberCountLimit,
    });
  });

  it('should ask which limit when --limit is missing and someone can answer', async () => {
    stubInteractiveTerminal();
    vi.mocked(select).mockResolvedValue('memberCountLimit');
    respondWithLimits();

    await limitGetCommand.action(
      { organization: GLOBEX_ORGANIZATION.id },
      undefined,
    );

    expect(select).toHaveBeenCalledWith({
      message: 'Which limit?',
      options: [
        { label: 'appCountLimit', value: 'appCountLimit' },
        { label: 'memberCountLimit', value: 'memberCountLimit' },
      ],
    });
    expect(harness.readLines()[0]).toBe('Limit       memberCountLimit');
  });

  it('should throw `missing_parameter` when --limit is missing and nobody can answer', async () => {
    respondWithLimits();

    await expect(
      limitGetCommand.action(
        { json: true, organization: GLOBEX_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(MissingParameterError);
  });

  it('should throw `invalid_parameter` when no limit carries the key', async () => {
    respondWithLimits();

    await expect(
      limitGetCommand.action(
        { limit: 'widgetsLimit', organization: GLOBEX_ORGANIZATION.id },
        undefined,
      ),
    ).rejects.toThrow(new UnknownNameError('limit', 'widgetsLimit'));
  });
});
