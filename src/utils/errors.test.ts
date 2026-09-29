import { describe, expect, it } from 'vitest';
import type { CliError } from './errors.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
  MissingParameterError,
  NoTtyError,
  NotLoggedInError,
  UnexpectedError,
  UnknownCommandError,
} from './errors.js';

describe('errors', () => {
  it.each<[CliError, string, number]>([
    [
      new ConfirmationRequiredError('reaches 10 devices in production'),
      'E_CONFIRMATION_REQUIRED',
      4,
    ],
    [
      new InvalidParameterError('--limit: Too big', new Error('Too big')),
      'E_INVALID_PARAMETER',
      2,
    ],
    [new MissingParameterError('--channel'), 'E_MISSING_PARAMETER', 2],
    [new NoTtyError(), 'E_NO_TTY', 1],
    [new NotLoggedInError(), 'E_NOT_LOGGED_IN', 3],
    [new UnexpectedError(new Error('boom')), 'E_UNEXPECTED', 1],
    [
      new UnknownCommandError('relese create', 'release create'),
      'E_UNKNOWN_COMMAND',
      1,
    ],
  ])('should carry the code and exit code of %o', (error, code, exitCode) => {
    expect(error.code).toBe(code);
    expect(error.exitCode).toBe(exitCode);
  });

  it('should state the consequence when a confirmation is required', () => {
    const error = new ConfirmationRequiredError(
      'reaches 10 devices in production',
    );

    expect(error.message).toBe(
      'a confirmation is required: reaches 10 devices in production',
    );
    expect(error.fix).toBe('pass --yes to confirm.');
  });

  it('should name the flag when a parameter is missing', () => {
    const error = new MissingParameterError('--channel');

    expect(error.message).toBe('--channel is missing');
    expect(error.fix).toContain('pass --channel');
  });

  it('should suggest the closest command when one is known', () => {
    const error = new UnknownCommandError('relese create', 'release create');

    expect(error.message).toBe('"relese create" is not a command');
    expect(error.fix).toBe('did you mean "release create"?');
  });

  it('should point at the help when no command is close', () => {
    const error = new UnknownCommandError('deploy', undefined);

    expect(error.fix).toBe('run "hotcodepush --help" to list the commands.');
  });

  it('should keep the cause of an unexpected error', () => {
    const cause = new Error('boom');

    const error = new UnexpectedError(cause);

    expect(error.message).toBe('boom');
    expect(error.cause).toBe(cause);
  });

  it('should take the text of a thrown value that is not an error', () => {
    expect(new UnexpectedError('boom').message).toBe('boom');
  });
});
