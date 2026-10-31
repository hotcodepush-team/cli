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
import { resolveFlagName } from './flag-name.js';
import { printJson } from './output.js';

// The API catalog answers `{ code, message }`.
// The device flow endpoints answer `{ error, error_description }` as RFC 8628 defines.
export interface ApiErrorResponse {
  code?: string;
  error?: string;
  error_description?: string;
  message?: string;
  status: number;
  statusText: string;
}

export interface ErrorJson {
  error: {
    code: string;
    fix: string | null;
    message: string;
  };
}

interface ErrorLinesOptions {
  isColorEnabled: boolean;
}

interface PrintErrorOptions {
  isJson: boolean;
  isVerbose: boolean;
}

// Matches the end of a sentence. A message from zodline or an unexpected error may lack it.
const SENTENCE_END_PATTERN = /[.!?]$/;

const UNEXPECTED_RESPONSE_CODE = 'unexpected_response';

export function buildErrorJson({ code, fix, message }: CliError): ErrorJson {
  return { error: { code, message, fix } };
}

export function resolveSentence(message: string): string {
  return SENTENCE_END_PATTERN.test(message) ? message : `${message}.`;
}

// An API error message says what to do itself, so it has no fix.
export function buildErrorLines(
  { code, fix, message }: CliError,
  options: ErrorLinesOptions,
): string[] {
  const sentence = fix === null ? message : resolveSentence(message);
  const styledSentence = options.isColorEnabled
    ? styleText('red', sentence, { validateStream: false })
    : sentence;
  return [
    fix === null ? styledSentence : `${styledSentence} ${fix}`,
    `${ERRORS_DOCS_URL}#${code}`,
  ];
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
    const errorLines = buildErrorLines(cliError, {
      isColorEnabled: isColorEnabled(process.stderr),
    });
    process.stderr.write(`${errorLines.join('\n')}\n`);
  }
}

// A response without a code, such as a proxy HTML page, is not an error from the API catalog.
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

export function resolveCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  if (error instanceof HotCodePushError) {
    return error.code === UNEXPECTED_RESPONSE_CODE
      ? new UnexpectedResponseError(error.status, error)
      : new ApiError(error.code, error.message, error.status);
  }
  if (error instanceof ZodError) {
    return new InvalidParameterError(
      resolveZodErrorMessage(error),
      undefined,
      error,
    );
  }
  if (error instanceof ZodlineError) {
    return new InvalidParameterError(
      resolveSentence(stripVTControlCharacters(error.message)),
      undefined,
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
  return `The value of --${resolveFlagName(key)} is invalid. ${issue.message}.`;
}
