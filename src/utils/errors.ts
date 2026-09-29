import { ISSUES_URL } from '../config/consts.js';

export const ExitCode = {
  ConfirmationRequired: 4,
  Error: 1,
  MissingOrInvalidParameter: 2,
  NotLoggedIn: 3,
  Success: 0,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

interface CliErrorOptions {
  cause?: unknown;
  code: string;
  exitCode: ExitCode;
  fix: string | null;
  message: string;
}

/**
 * Where a person approves a login: the page with the code filled in, and the code to compare it with.
 */
export interface DeviceAuthorizationPrompt {
  userCode: string;
  verificationUrl: string;
}

/**
 * An error of the CLI's own catalog: the one thing a command throws when it cannot go on.
 * The message says what happened and the fix what to do; the entry point prints both and exits with the exit code.
 */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly fix: string | null;

  constructor({ cause, code, exitCode, fix, message }: CliErrorOptions) {
    super(message, { cause });
    this.code = code;
    this.exitCode = exitCode;
    this.fix = fix;
    this.name = new.target.name;
  }
}

/**
 * A name several resources carry: organizations can share one, and apps of different organizations can.
 */
export class AmbiguousNameError extends CliError {
  constructor(noun: string, name: string) {
    super({
      code: 'E_INVALID_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: `pass the id instead, as "hotcodepush ${noun} list" prints it.`,
      message: `--${noun}: several ${noun}s are named "${name}"`,
    });
  }
}

/**
 * An error the API answered with, its code and message passed through as received and never re-mapped.
 * The API's message carries its own fix, so it has none; a 401 means the token no longer counts, exit code 3.
 */
export class ApiError extends CliError {
  constructor(code: string, message: string, status: number) {
    super({
      code,
      exitCode: status === 401 ? ExitCode.NotLoggedIn : ExitCode.Error,
      fix: null,
      message,
    });
  }
}

export class ConfirmationRequiredError extends CliError {
  constructor(consequence: string) {
    super({
      code: 'E_CONFIRMATION_REQUIRED',
      exitCode: ExitCode.ConfirmationRequired,
      fix: 'pass --yes to confirm.',
      message: `a confirmation is required: ${consequence}`,
    });
  }
}

export class InvalidParameterError extends CliError {
  constructor(message: string, cause: unknown) {
    super({
      cause,
      code: 'E_INVALID_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: 'run the command with --help to see its options.',
      message,
    });
  }
}

export class LoginDeniedError extends CliError {
  constructor() {
    super({
      code: 'E_LOGIN_DENIED',
      exitCode: ExitCode.Error,
      fix: 'run "hotcodepush login" again to approve it.',
      message: 'the login was denied in the browser',
    });
  }
}

export class LoginExpiredError extends CliError {
  constructor() {
    super({
      code: 'E_LOGIN_EXPIRED',
      exitCode: ExitCode.Error,
      fix: 'run "hotcodepush login" again and approve the code before it expires.',
      message: 'the login code expired before it was approved',
    });
  }
}

export class MissingParameterError extends CliError {
  constructor(flag: string) {
    super({
      code: 'E_MISSING_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: `pass ${flag}, or run the command interactively to be asked for it.`,
      message: `${flag} is missing`,
    });
  }
}

export class NoTtyError extends CliError {
  constructor() {
    super({
      code: 'E_NO_TTY',
      exitCode: ExitCode.Error,
      fix: 'run it in a terminal, outside CI and without --json or --yes.',
      message: 'the command needs an interactive terminal',
    });
  }
}

/**
 * Without a prompt the fix names `login`; with one, from a login that cannot wait for the approval,
 * it carries the page and the code for an agent to relay.
 */
export class NotLoggedInError extends CliError {
  constructor(deviceAuthorizationPrompt?: DeviceAuthorizationPrompt) {
    super({
      code: 'E_NOT_LOGGED_IN',
      exitCode: ExitCode.NotLoggedIn,
      fix: deviceAuthorizationPrompt
        ? `approve at ${deviceAuthorizationPrompt.verificationUrl} with code ${deviceAuthorizationPrompt.userCode}, then run "hotcodepush login" again.`
        : 'run "hotcodepush login", or set HOTCODEPUSH_TOKEN.',
      message: 'you are not logged in',
    });
  }
}

export class UnexpectedError extends CliError {
  constructor(cause: unknown) {
    super({
      cause,
      code: 'E_UNEXPECTED',
      exitCode: ExitCode.Error,
      fix: `run the command again with --verbose, and report it at ${ISSUES_URL} if it persists.`,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export class UnknownCommandError extends CliError {
  constructor(typedCommand: string, closestCommandName: string | undefined) {
    super({
      code: 'E_UNKNOWN_COMMAND',
      exitCode: ExitCode.Error,
      fix: closestCommandName
        ? `did you mean "${closestCommandName}"?`
        : 'run "hotcodepush --help" to list the commands.',
      message: `"${typedCommand}" is not a command`,
    });
  }
}

/**
 * A name no resource carries; an id the API does not know is the API's own E_NOT_FOUND instead.
 */
export class UnknownNameError extends CliError {
  constructor(noun: string, name: string) {
    super({
      code: 'E_INVALID_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: `run "hotcodepush ${noun} list" to see the names.`,
      message: `--${noun}: no ${noun} is named "${name}"`,
    });
  }
}
