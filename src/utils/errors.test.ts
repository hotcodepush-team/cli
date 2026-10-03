import { describe, expect, it } from 'vitest';
import type { CliError } from './errors.js';
import {
  AmbiguousNameError,
  ApiError,
  ConfirmationRequiredError,
  FingerprintUnavailableError,
  InvalidParameterError,
  LoginDeniedError,
  LoginExpiredError,
  MissingParameterError,
  NotLoggedInError,
  SigningKeyUnavailableError,
  UnexpectedError,
  UnknownCommandError,
  UnknownNameError,
} from './errors.js';

describe('errors', () => {
  it.each<[CliError, string, number]>([
    [new AmbiguousNameError('organization', 'Acme'), 'E_INVALID_PARAMETER', 2],
    [
      new ApiError('E_FORBIDDEN', 'Your role is too low.', 403),
      'E_FORBIDDEN',
      1,
    ],
    [
      new ApiError('E_UNAUTHENTICATED', 'Sign in again.', 401),
      'E_UNAUTHENTICATED',
      3,
    ],
    [
      new ConfirmationRequiredError('reaches 10 devices in production'),
      'E_CONFIRMATION_REQUIRED',
      4,
    ],
    [
      new FingerprintUnavailableError(new Error('the project has no lockfile')),
      'E_FINGERPRINT_UNAVAILABLE',
      1,
    ],
    [
      new InvalidParameterError('--limit: Too big', new Error('Too big')),
      'E_INVALID_PARAMETER',
      2,
    ],
    [new LoginDeniedError(), 'E_LOGIN_DENIED', 1],
    [new LoginExpiredError(), 'E_LOGIN_EXPIRED', 1],
    [new MissingParameterError('--channel'), 'E_MISSING_PARAMETER', 2],
    [new NotLoggedInError(), 'E_NOT_LOGGED_IN', 3],
    [
      new SigningKeyUnavailableError('/config/hotcodepush/keys/app.key'),
      'E_SIGNING_KEY_UNAVAILABLE',
      1,
    ],
    [new UnexpectedError(new Error('boom')), 'E_UNEXPECTED', 1],
    [
      new UnknownCommandError('relese create', 'release create'),
      'E_UNKNOWN_COMMAND',
      1,
    ],
    [new UnknownNameError('channel', 'staging'), 'E_INVALID_PARAMETER', 2],
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

  it('should carry the page and the code when a login cannot wait for the approval', () => {
    const error = new NotLoggedInError({
      userCode: 'WDJBMJHT',
      verificationUrl: 'https://console.example.com/device?user_code=WDJBMJHT',
    });

    expect(error.fix).toBe(
      'approve at https://console.example.com/device?user_code=WDJBMJHT with code WDJBMJHT, then run "hotcodepush login" again.',
    );
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

  it('should name the flag and the list command when no resource carries a name', () => {
    const error = new UnknownNameError('channel', 'staging');

    expect(error.message).toBe('--channel: no channel is named "staging"');
    expect(error.fix).toBe('run "hotcodepush channel list" to see the names.');
  });

  it('should ask for the id when several resources carry a name', () => {
    const error = new AmbiguousNameError('organization', 'Acme');

    expect(error.message).toBe(
      '--organization: several organizations are named "Acme"',
    );
    expect(error.fix).toBe(
      'pass the id instead, as "hotcodepush organization list" prints it.',
    );
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
