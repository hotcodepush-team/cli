import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ZodlineError } from 'zodline';
import {
  buildErrorJson,
  buildErrorLine,
  printError,
  resolveCliError,
} from './error-mapping.js';
import { MissingParameterError, UnknownCommandError } from './errors.js';

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
  describe('resolveCliError', () => {
    it('should keep an error of the catalog as it is', () => {
      const error = new MissingParameterError('--channel');

      expect(resolveCliError(error)).toBe(error);
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
