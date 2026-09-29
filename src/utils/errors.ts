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
  fix: string;
  message: string;
}

/**
 * An error of the CLI's own catalog: the one thing a command throws when it cannot go on.
 * The message says what happened and the fix what to do; the entry point prints both and exits with the exit code.
 */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly fix: string;

  constructor({ cause, code, exitCode, fix, message }: CliErrorOptions) {
    super(message, { cause });
    this.code = code;
    this.exitCode = exitCode;
    this.fix = fix;
    this.name = new.target.name;
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

export class NotLoggedInError extends CliError {
  constructor() {
    super({
      code: 'E_NOT_LOGGED_IN',
      exitCode: ExitCode.NotLoggedIn,
      fix: 'run "hotcodepush login", or set HOTCODEPUSH_TOKEN.',
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
