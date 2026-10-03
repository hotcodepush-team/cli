import { inspect, stripVTControlCharacters, styleText } from 'node:util';
import { HotCodePushError } from '@hotcodepush/node';
import { ZodError } from 'zod';
import { ZodlineError } from 'zodline';
import { ERRORS_DOCS_URL } from '../config/consts.js';
import { isColorEnabled } from './environment.js';
import {
  ApiError,
  CliError,
  InvalidParameterError,
  UnexpectedError,
  UnexpectedResponseError,
} from './errors.js';
import { printJson } from './output.js';

/**
 * An error response as Better Auth's client hands it over: the API's catalog answers `{ code, message }`,
 * the device flow's endpoints RFC 8628's `{ error, error_description }`.
 */
export interface ApiErrorResponse {
  code?: string;
  error?: string;
  error_description?: string;
  message?: string;
  status: number;
  statusText: string;
}

/**
 * The `--json` shape of an error, printed on stdout with nothing else, so an agent parses one stream.
 */
export interface ErrorJson {
  error: {
    code: string;
    fix: string | null;
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

/** The typed client's code for an answer outside the API's shape, which the CLI's catalog renders. */
const UNEXPECTED_RESPONSE_CODE = 'E_UNEXPECTED_RESPONSE';

export function buildErrorJson({ code, fix, message }: CliError): ErrorJson {
  return { error: { code, message, fix } };
}

/**
 * One line: the code in front, what happened, what to do, and the code's page behind it.
 * An API error's message says what to do itself, so its line has no fix.
 */
export function buildErrorLine(
  { code, fix, message }: CliError,
  options: ErrorLineOptions,
): string {
  const styledCode = options.isColorEnabled
    ? styleText(['bold', 'red'], code, { validateStream: false })
    : code;
  const fixSegment = fix === null ? '' : ` — ${fix}`;
  return `${styledCode} ${message}${fixSegment} ${ERRORS_DOCS_URL}#${code}`;
}

export function printError(
  cliError: CliError,
  { isJson, isVerbose }: PrintErrorOptions,
): void {
  if (isVerbose) {
    process.stderr.write(`${inspect(cliError)}\n`);
  }
  if (isJson) {
    printJson(buildErrorJson(cliError));
  } else {
    process.stderr.write(
      `${buildErrorLine(cliError, { isColorEnabled: isColorEnabled(process.stderr) })}\n`,
    );
  }
}

/**
 * The API's error as received; a response without a code, a proxy's HTML page, is no error of the API's catalog.
 */
export function resolveApiError({
  code,
  error,
  error_description,
  message,
  status,
  statusText,
}: ApiErrorResponse): CliError {
  const receivedCode = code ?? error;
  if (receivedCode === undefined) {
    return new UnexpectedResponseError(status);
  }
  return new ApiError(
    receivedCode,
    message ?? error_description ?? statusText,
    status,
  );
}

/**
 * Maps anything a command line can throw to the CLI's catalog: its own errors as they are, the typed client's
 * as the API answered them unless the answer was outside the API's shape, zod and zodline's parameter errors to
 * `E_INVALID_PARAMETER`, everything else to `E_UNEXPECTED`.
 */
export function resolveCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  if (error instanceof HotCodePushError) {
    return error.code === UNEXPECTED_RESPONSE_CODE
      ? new UnexpectedResponseError(error.status)
      : new ApiError(error.code, error.message, error.status);
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
