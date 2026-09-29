import { inspect, stripVTControlCharacters, styleText } from 'node:util';
import { ZodError } from 'zod';
import { ZodlineError } from 'zodline';
import { ERRORS_DOCS_URL } from '../config/consts.js';
import { isColorEnabled } from './environment.js';
import { CliError, InvalidParameterError, UnexpectedError } from './errors.js';

/**
 * The `--json` shape of an error, printed on stdout with nothing else, so an agent parses one stream.
 */
export interface ErrorJson {
  error: {
    code: string;
    fix: string;
    message: string;
  };
}

interface ErrorLineOptions {
  isColorEnabled: boolean;
}

interface PrintErrorOptions {
  isJson: boolean;
  isVerbose: boolean;
}

export function buildErrorJson({ code, fix, message }: CliError): ErrorJson {
  return { error: { code, message, fix } };
}

/**
 * One line: the code in front, what happened, what to do, and the code's page behind it.
 */
export function buildErrorLine(
  { code, fix, message }: CliError,
  options: ErrorLineOptions,
): string {
  const styledCode = options.isColorEnabled
    ? styleText(['bold', 'red'], code, { validateStream: false })
    : code;
  return `${styledCode} ${message} — ${fix} ${ERRORS_DOCS_URL}#${code}`;
}

export function printError(
  cliError: CliError,
  { isJson, isVerbose }: PrintErrorOptions,
): void {
  if (isVerbose) {
    process.stderr.write(`${inspect(cliError)}\n`);
  }
  if (isJson) {
    process.stdout.write(
      `${JSON.stringify(buildErrorJson(cliError), null, 2)}\n`,
    );
  } else {
    process.stderr.write(
      `${buildErrorLine(cliError, { isColorEnabled: isColorEnabled(process.stderr) })}\n`,
    );
  }
}

/**
 * Maps anything a command line can throw to the CLI's catalog: its own errors as they are,
 * zod and zodline's parameter errors to `E_INVALID_PARAMETER`, everything else to `E_UNEXPECTED`.
 */
export function resolveCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  if (error instanceof ZodError) {
    return new InvalidParameterError(resolveZodErrorMessage(error), error);
  }
  if (error instanceof ZodlineError) {
    return new InvalidParameterError(
      stripVTControlCharacters(error.message),
      error,
    );
  }
  return new UnexpectedError(error);
}

function resolveZodErrorMessage(error: ZodError): string {
  const [issue] = error.issues;
  if (!issue) {
    return error.message;
  }
  const [key] = issue.path;
  if (typeof key !== 'string') {
    return issue.message;
  }
  const flag = `--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
  return `${flag}: ${issue.message}`;
}
