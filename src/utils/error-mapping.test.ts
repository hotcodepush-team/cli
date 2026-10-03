import { HotCodePushError } from '@hotcodepush/node';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ZodlineError } from 'zodline';
import {
  buildErrorJson,
  buildErrorLine,
  printError,
  resolveApiError,
  resolveCliError,
} from './error-mapping.js';
import {
  ApiError,
  MissingParameterError,
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
        code: 'E_RATE_LIMITED',
        message: 'Too many attempts; wait 60 seconds and try again.',
        status: 429,
        statusText: 'Too Many Requests',
      });

      expect(cliError).toBeInstanceOf(ApiError);
      expect(cliError.code).toBe('E_RATE_LIMITED');
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

    it('should map a response without a code to E_UNEXPECTED_RESPONSE, as the typed client does', () => {
      const cliError = resolveApiError({
        status: 502,
        statusText: 'Bad Gateway',
      });

      expect(cliError).toEqual(new UnexpectedResponseError(502));
      expect(cliError.code).toBe('E_UNEXPECTED_RESPONSE');
      expect(cliError.message).toBe('the API answered 502 outside its shape');
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
            code: 'E_UNAUTHENTICATED',
            message: 'The bearer token is missing, invalid or expired.',
          },
          401,
        ),
      );

      expect(cliError).toBeInstanceOf(ApiError);
      expect(cliError.code).toBe('E_UNAUTHENTICATED');
      expect(cliError.message).toBe(
        'The bearer token is missing, invalid or expired.',
      );
      expect(cliError.exitCode).toBe(3);
    });

    it("should render the typed client's answer outside the API's shape as the auth client's", () => {
      const cliError = resolveCliError(
        new HotCodePushError(
          {
            code: 'E_UNEXPECTED_RESPONSE',
            message: 'Request failed with status 502.',
          },
          502,
        ),
      );

      expect(cliError).toEqual(
        resolveApiError({ status: 502, statusText: 'Bad Gateway' }),
      );
    });

    it('should map a zod validation error to E_INVALID_PARAMETER naming the flag', () => {
      const result = z
        .object({ rolloutPercentage: z.number().max(100) })
        .safeParse({
          rolloutPercentage: 120,
        });

      const cliError = resolveCliError(result.error);

      expect(cliError.code).toBe('E_INVALID_PARAMETER');
      expect(cliError.exitCode).toBe(2);
      expect(cliError.message).toMatch(/^--rollout-percentage: /);
    });

    it('should map a zodline error to E_INVALID_PARAMETER without its colour codes', () => {
      const cliError = resolveCliError(
        new ZodlineError('Unknown option: \x1b[36m--foo\x1b[0m'),
      );

      expect(cliError.code).toBe('E_INVALID_PARAMETER');
      expect(cliError.message).toBe('Unknown option: --foo');
    });

    it('should map any other error to E_UNEXPECTED with exit code 1', () => {
      const cause = new TypeError('boom');

      const cliError = resolveCliError(cause);

      expect(cliError.code).toBe('E_UNEXPECTED');
      expect(cliError.exitCode).toBe(1);
      expect(cliError.cause).toBe(cause);
    });
  });

  describe('buildErrorJson', () => {
    it('should build the one error shape', () => {
      expect(buildErrorJson(new MissingParameterError('--channel'))).toEqual({
        error: {
          code: 'E_MISSING_PARAMETER',
          fix: 'pass --channel, or run the command interactively to be asked for it.',
          message: '--channel is missing',
        },
      });
    });
  });

  describe('buildErrorLine', () => {
    it('should put the code in front and its page behind', () => {
      const line = buildErrorLine(
        new UnknownCommandError('relese create', 'release create'),
        {
          isColorEnabled: false,
        },
      );

      expect(line).toBe(
        'E_UNKNOWN_COMMAND "relese create" is not a command — did you mean "release create"? https://hotcodepush.com/docs/cli/errors#E_UNKNOWN_COMMAND',
      );
    });

    it('should leave the fix out when the error carries none', () => {
      const line = buildErrorLine(
        new ApiError(
          'E_UNAUTHENTICATED',
          'The bearer token is missing, invalid or expired; sign in again or create a new token.',
          401,
        ),
        { isColorEnabled: false },
      );

      expect(line).toBe(
        'E_UNAUTHENTICATED The bearer token is missing, invalid or expired; sign in again or create a new token. https://hotcodepush.com/docs/cli/errors#E_UNAUTHENTICATED',
      );
    });

    it('should colour the code when colour is enabled', () => {
      const line = buildErrorLine(new MissingParameterError('--channel'), {
        isColorEnabled: true,
      });

      expect(line).toContain('\x1b[');
    });
  });

  describe('printError', () => {
    it('should print the line on stderr and nothing on stdout', () => {
      const output = captureOutput();

      printError(new MissingParameterError('--channel'), {
        isJson: false,
        isVerbose: false,
      });

      expect(output.readStderr()).toMatch(
        /^E_MISSING_PARAMETER --channel is missing — /,
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
      expect(JSON.parse(output.readStdout()).error.code).toBe('E_UNEXPECTED');
    });
  });
});
