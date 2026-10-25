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
  PipelineNotLoggedInError,
  SigningKeyUnavailableError,
  UnexpectedError,
  UnknownCommandError,
  UnknownNameError,
  XcodeProjectError,
} from './errors.js';

describe('errors', () => {
  it.each<[CliError, string, number]>([
    [new AmbiguousNameError('organization', 'Acme'), 'invalid_parameter', 2],
    [new ApiError('forbidden', 'Your role is too low.', 403), 'forbidden', 1],
    [
      new ApiError('unauthenticated', 'Sign in again.', 401),
      'unauthenticated',
      3,
    ],
    [
      new ConfirmationRequiredError('reaches 10 devices in production'),
      'confirmation_required',
      4,
    ],
    [
      new FingerprintUnavailableError(
        new Error('The project has no lockfile.'),
      ),
      'fingerprint_unavailable',
      1,
    ],
    [
      new InvalidParameterError(
        '--limit: Too big',
        undefined,
        new Error('Too big'),
      ),
      'invalid_parameter',
      2,
    ],
    [new LoginDeniedError(), 'login_denied', 1],
    [new LoginExpiredError(), 'login_expired', 1],
    [new MissingParameterError('--channel'), 'missing_parameter', 2],
    [new NotLoggedInError(), 'not_logged_in', 3],
    [new PipelineNotLoggedInError(), 'not_logged_in', 3],
    [new SigningKeyUnavailableError(), 'signing_key_unavailable', 1],
    [new UnexpectedError(new Error('boom')), 'unexpected', 1],
    [
      new UnknownCommandError('relese create', 'release create'),
      'unknown_command',
      1,
    ],
    [new UnknownNameError('channel', 'staging'), 'invalid_parameter', 2],
  ])('should carry the code and exit code of %o', (error, code, exitCode) => {
    expect(error.code).toBe(code);
    expect(error.exitCode).toBe(exitCode);
  });

  it('should state the consequence when a confirmation is required', () => {
    const error = new ConfirmationRequiredError(
      'reaches 10 devices in production',
    );

    expect(error.message).toBe(
      'A confirmation is required. This reaches 10 devices in production.',
    );
    expect(error.fix).toBe('Pass --yes to confirm.');
  });

  it('should carry the page and the code when a login cannot wait for the approval', () => {
    const error = new NotLoggedInError({
      userCode: 'WDJBMJHT',
      verificationUrl: 'https://console.example.com/device?user_code=WDJBMJHT',
    });

    expect(error.fix).toBe(
      'Approve at https://console.example.com/device?user_code=WDJBMJHT with code WDJBMJHT, then run "hotcodepush login" again.',
    );
  });

  it('should name the flag when a parameter is missing', () => {
    const error = new MissingParameterError('--channel');

    expect(error.message).toBe('No value was given for --channel.');
    expect(error.fix).toContain('Pass --channel');
  });

  it('should suggest the closest command when one is known', () => {
    const error = new UnknownCommandError('relese create', 'release create');

    expect(error.message).toBe('There is no command "relese create".');
    expect(error.fix).toBe('Did you mean "release create"?');
  });

  it('should point at the help when no command is close', () => {
    const error = new UnknownCommandError('deploy', undefined);

    expect(error.fix).toBe('Run "hotcodepush --help" to list the commands.');
  });

  it('should name the flag and the list command when no resource carries a name', () => {
    const error = new UnknownNameError('channel', 'staging');

    expect(error.message).toBe(
      'The channel "staging" from --channel does not exist.',
    );
    expect(error.fix).toBe('Run "hotcodepush channel list" to see the names.');
  });

  it('should ask for the id when several resources carry a name', () => {
    const error = new AmbiguousNameError('organization', 'Acme');

    expect(error.message).toBe(
      'Several organizations carry the name "Acme" from --organization.',
    );
    expect(error.fix).toBe(
      'Pass the id instead, as "hotcodepush organization list" prints it.',
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

  it('should ask for the build phase by hand when an Xcode edit names no fix of its own', () => {
    const error = new XcodeProjectError(
      'The Xcode project ios/App.xcodeproj/project.pbxproj could not be parsed.',
      undefined,
      'ios/App.xcodeproj/project.pbxproj',
    );

    expect(error.fix).toBe(
      'Add the build phase to the app target in ios/App.xcodeproj/project.pbxproj by hand.',
    );
  });
});
