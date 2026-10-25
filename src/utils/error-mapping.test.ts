import { HotCodePushError } from '@hotcodepush/node';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ZodlineError } from 'zodline';
import {
  buildErrorJson,
  buildErrorLines,
  printError,
  resolveApiError,
  resolveCliError,
} from './error-mapping.js';
import {
  ApiError,
  MissingParameterError,
  NotLoggedInError,
  UnexpectedResponseError,
  UnknownCommandError,
} from './errors.js';

function captureOutput() {
  const stderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const stdoutWrite = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  return {
    readStderr: () =>
      stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
    readStdout: () =>
      stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
  };
}

describe('error mapping', () => {
  describe('resolveApiError', () => {
    it("should pass the API's code and message through as received", () => {
      const cliError = resolveApiError({
        code: 'rate_limited',
        message: 'Too many attempts; wait 60 seconds and try again.',
        status: 429,
        statusText: 'Too Many Requests',
      });

      expect(cliError).toBeInstanceOf(ApiError);
      expect(cliError.code).toBe('rate_limited');
      expect(cliError.message).toBe(
        'Too many attempts; wait 60 seconds and try again.',
      );
      expect(cliError.fix).toBeNull();
    });

    it("should pass the device flow's error and description through as received", () => {
      const cliError = resolveApiError({
        error: 'invalid_grant',
        error_description: 'Invalid device code',
        status: 400,
        statusText: 'Bad Request',
      });

      expect(cliError.code).toBe('invalid_grant');
      expect(cliError.message).toBe('Invalid device code');
    });

    it("should map a response without a code to `unexpected_response`, as it maps the typed client's answer outside the API's shape", () => {
      const cliError = resolveApiError({
        status: 502,
        statusText: 'Bad Gateway',
      });

      expect(cliError).toEqual(new UnexpectedResponseError(502));
      expect(cliError.code).toBe('unexpected_response');
      expect(cliError.message).toBe(
        'The API answered with status 502 in an unexpected shape.',
      );
    });
  });

  describe('resolveCliError', () => {
    it('should keep an error of the catalog as it is', () => {
      const error = new MissingParameterError('--channel');

      expect(resolveCliError(error)).toBe(error);
    });

    it("should pass the typed client's error through as the API answered it", () => {
      const cliError = resolveCliError(
        new HotCodePushError(
          {
            code: 'unauthenticated',
            message: 'The bearer token is missing, invalid or expired.',
          },
          401,
        ),
      );

      expect(cliError).toBeInstanceOf(ApiError);
      expect(cliError.code).toBe('unauthenticated');
      expect(cliError.message).toBe(
        'The bearer token is missing, invalid or expired.',
      );
      expect(cliError.exitCode).toBe(3);
    });

    it("should render the typed client's answer outside the API's shape as the auth client's", () => {
      const cliError = resolveCliError(
        new HotCodePushError(
          {
            code: 'unexpected_response',
            message: 'Request failed with status 502.',
          },
          502,
        ),
      );

      expect(cliError).toEqual(
        resolveApiError({ status: 502, statusText: 'Bad Gateway' }),
      );
    });

    it('should map a zod validation error to `invalid_parameter` naming the flag', () => {
      const result = z
        .object({ rolloutPercentage: z.number().max(100) })
        .safeParse({
          rolloutPercentage: 120,
        });

      const cliError = resolveCliError(result.error);

      expect(cliError.code).toBe('invalid_parameter');
      expect(cliError.exitCode).toBe(2);
      expect(cliError.message).toMatch(
        /^The value of --rollout-percentage is invalid\. .+\.$/,
      );
    });

    it('should map a zodline error to `invalid_parameter` as a sentence without its colour codes', () => {
      const cliError = resolveCliError(
        new ZodlineError('Unknown option: \x1b[36m--foo\x1b[0m'),
      );

      expect(cliError.code).toBe('invalid_parameter');
      expect(cliError.message).toBe('Unknown option: --foo.');
    });

    it('should map any other error to `unexpected` with exit code 1', () => {
      const cause = new TypeError('boom');

      const cliError = resolveCliError(cause);

      expect(cliError.code).toBe('unexpected');
      expect(cliError.exitCode).toBe(1);
      expect(cliError.cause).toBe(cause);
    });
  });

  describe('buildErrorJson', () => {
    it('should build the one error shape', () => {
      expect(buildErrorJson(new MissingParameterError('--channel'))).toEqual({
        error: {
          code: 'missing_parameter',
          fix: 'Pass --channel, or run the command interactively to be asked for it.',
          message: 'No value was given for --channel.',
        },
      });
    });
  });

  describe('buildErrorLines', () => {
    it('should put the message and the fix on the first line and the page on the second', () => {
      const lines = buildErrorLines(new NotLoggedInError(), {
        isColorEnabled: false,
      });

      expect(lines).toEqual([
        'You are not logged in. Run "hotcodepush login" or set HOTCODEPUSH_TOKEN.',
        'https://hotcodepush.com/docs/cli/errors#not_logged_in',
      ]);
    });

    it('should never start a line with the code', () => {
      const lines = buildErrorLines(
        new UnknownCommandError('relese create', 'release create'),
        { isColorEnabled: false },
      );

      expect(lines).toEqual([
        'There is no command "relese create". Did you mean "release create"?',
        'https://hotcodepush.com/docs/cli/errors#unknown_command',
      ]);
      for (const line of lines) {
        expect(line).not.toMatch(/^unknown_command/);
      }
    });

    it('should leave the fix out and the message as received when the error carries none', () => {
      const lines = buildErrorLines(
        new ApiError('invalid_grant', 'Invalid device code', 400),
        { isColorEnabled: false },
      );

      expect(lines).toEqual([
        'Invalid device code',
        'https://hotcodepush.com/docs/cli/errors#invalid_grant',
      ]);
    });

    it('should end a message without its full stop with one when a fix follows', () => {
      const lines = buildErrorLines(
        resolveCliError(new ZodlineError('Unknown option: --foo')),
        { isColorEnabled: false },
      );

      expect(lines[0]).toBe(
        'Unknown option: --foo. Run the command with --help to see its options.',
      );
    });

    it('should colour the message when colour is enabled', () => {
      const [firstLine] = buildErrorLines(
        new MissingParameterError('--channel'),
        { isColorEnabled: true },
      );

      expect(firstLine).toContain('\x1b[');
    });
  });

  describe('printError', () => {
    it('should print the two lines on stderr and nothing on stdout', () => {
      const output = captureOutput();

      printError(new MissingParameterError('--channel'), {
        isJson: false,
        isVerbose: false,
      });

      expect(output.readStderr()).toBe(
        'No value was given for --channel. Pass --channel, or run the command interactively to be asked for it.\nhttps://hotcodepush.com/docs/cli/errors#missing_parameter\n',
      );
      expect(output.readStdout()).toBe('');
    });

    it('should print only the JSON on stdout when --json is passed', () => {
      const output = captureOutput();

      printError(new MissingParameterError('--channel'), {
        isJson: true,
        isVerbose: false,
      });

      expect(JSON.parse(output.readStdout())).toEqual(
        buildErrorJson(new MissingParameterError('--channel')),
      );
      expect(output.readStderr()).toBe('');
    });

    it('should print the stack on stderr when --verbose is passed', () => {
      const output = captureOutput();

      printError(resolveCliError(new TypeError('boom')), {
        isJson: true,
        isVerbose: true,
      });

      expect(output.readStderr()).toContain('TypeError: boom');
      expect(JSON.parse(output.readStdout()).error.code).toBe('unexpected');
    });
  });
});
