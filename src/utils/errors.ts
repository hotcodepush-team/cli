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
  constructor(noun: string, name: string, source = `--${noun}`) {
    super({
      code: 'E_INVALID_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: `pass the id instead, as "hotcodepush ${noun} list" prints it.`,
      message: `${source}: several ${noun}s are named "${name}"`,
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

/**
 * The one public size limit, checked before a byte is sent so the API's own refusal is never reached with a wasted upload.
 */
export class BundleTooLargeError extends CliError {
  constructor(what: string, limitBytes: number) {
    super({
      code: 'E_BUNDLE_TOO_LARGE',
      exitCode: ExitCode.Error,
      fix: 'a file or a bundle is at most 512 MB; move large media out of the web build.',
      message: `${what} is above the limit of ${limitBytes} bytes`,
    });
  }
}

/**
 * A command the CLI ran for the project — the package install, the build script — that exited with a failure.
 */
export class CommandFailedError extends CliError {
  constructor(commandLine: string, exitCode: number | null) {
    super({
      code: 'E_COMMAND_FAILED',
      exitCode: ExitCode.Error,
      fix: 'run it by hand and read its output.',
      message: `"${commandLine}" exited with ${exitCode ?? 'a signal'}`,
    });
  }
}

export class ConfirmationRequiredError extends CliError {
  constructor(consequence: string, fix = 'pass --yes to confirm.') {
    super({
      code: 'E_CONFIRMATION_REQUIRED',
      exitCode: ExitCode.ConfirmationRequired,
      fix,
      message: `a confirmation is required: ${consequence}`,
    });
  }
}

/**
 * The hook script the CLI would add its command to is one it cannot parse as a command chain.
 */
export class HookOccupiedError extends CliError {
  constructor(hookName: string) {
    super({
      code: 'E_HOOK_OCCUPIED',
      exitCode: ExitCode.Error,
      fix: `append " && npx hotcodepush bundle embed" to the ${hookName} script in package.json.`,
      message: `${hookName} runs a script the CLI cannot parse`,
    });
  }
}

export class InvalidParameterError extends CliError {
  constructor(
    message: string,
    cause: unknown,
    fix = 'run the command with --help to see its options.',
  ) {
    super({
      cause,
      code: 'E_INVALID_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix,
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
  constructor(
    flag: string,
    fix = `pass ${flag}, or run the command interactively to be asked for it.`,
  ) {
    super({
      code: 'E_MISSING_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix,
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

/**
 * The outcome a command printed itself — `init`'s steps, `doctor`'s checks — ended in a failure:
 * only the exit code is left to set, and the entry point prints nothing more for it.
 */
export class ReportedFailureError extends CliError {
  constructor(code: string) {
    super({
      code,
      exitCode: ExitCode.Error,
      fix: null,
      message: 'reported above',
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

/**
 * An Xcode project the CLI cannot edit: unparseable, or without the group the resource belongs in.
 */
export class XcodeProjectError extends CliError {
  constructor(message: string, cause: unknown, projectFilePath: string) {
    super({
      cause,
      code: 'E_XCODE_PROJECT',
      exitCode: ExitCode.Error,
      fix: `add hotcodepush.json to the app target's Copy Bundle Resources in ${projectFilePath}.`,
      message,
    });
  }
}

export class UnknownFrameworkError extends CliError {
  constructor() {
    super({
      code: 'E_UNKNOWN_FRAMEWORK',
      exitCode: ExitCode.Error,
      fix: 'run it in a project with @capacitor/core, react-native, expo or cordova among its dependencies.',
      message: 'no supported framework was found in package.json',
    });
  }
}

/**
 * A framework the CLI knows but does not package yet; its packaging arrives with its SDK.
 */
export class UnsupportedFrameworkError extends CliError {
  constructor(framework: string) {
    super({
      code: 'E_UNSUPPORTED_FRAMEWORK',
      exitCode: ExitCode.Error,
      fix: 'Capacitor is packaged today; the other frameworks arrive with their SDKs.',
      message: `${framework} projects are not packaged yet`,
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
 * A name no resource carries, named with where it came from, its flag by default;
 * an id the API does not know is the API's own E_NOT_FOUND instead.
 */
export class UnknownNameError extends CliError {
  constructor(noun: string, name: string, source = `--${noun}`) {
    super({
      code: 'E_INVALID_PARAMETER',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: `run "hotcodepush ${noun} list" to see the names.`,
      message: `${source}: no ${noun} is named "${name}"`,
    });
  }
}
