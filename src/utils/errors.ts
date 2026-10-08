import { ISSUES_URL, PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';

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
 * The native contract's hash cannot be computed from the project: no lockfile, two, one the recipe cannot read,
 * no `package.json` it can read, or a package the lockfile installs that `node_modules` does not hold.
 * A build without it would match binaries it does not describe, so nothing goes on without it.
 */
export class FingerprintUnavailableError extends CliError {
  constructor(cause: Error) {
    super({
      cause,
      code: 'E_FINGERPRINT_UNAVAILABLE',
      exitCode: ExitCode.Error,
      fix: 'the fingerprint reads the committed lockfile and the installed packages; make both current and run the command again.',
      message: `the fingerprint cannot be computed: ${cause.message}`,
    });
  }
}

/**
 * A JSON file the CLI reads and a person edits that does not parse: the message names the file and where the parse stopped,
 * never the file's text, since `config.json` can hold the token.
 */
export class InvalidJsonError extends CliError {
  constructor(filePath: string, problem: string) {
    super({
      code: 'E_INVALID_JSON',
      exitCode: ExitCode.Error,
      fix: 'correct the JSON in that file and run the command again.',
      message: `${filePath} is no valid JSON: ${problem}`,
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

/**
 * Without a prompt the fix names `login`; with one, from a login that cannot wait for the approval,
 * it carries the page and the code for an agent to relay.
 */
/**
 * A native project file the CLI cannot edit: the line its edit replaces or follows is not there, so the fix is the edit by hand.
 */
export class NativeProjectError extends CliError {
  constructor(message: string, fix: string) {
    super({
      code: 'E_NATIVE_PROJECT',
      exitCode: ExitCode.Error,
      fix,
      message,
    });
  }
}

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
 * A pipeline building a binary without a token: a shipped build must name its channel, so CI fails where a local build goes on offline.
 */
export class PipelineNotLoggedInError extends CliError {
  constructor() {
    super({
      code: 'E_NOT_LOGGED_IN',
      exitCode: ExitCode.NotLoggedIn,
      fix: 'set HOTCODEPUSH_TOKEN in the pipeline, or HOTCODEPUSH_OFFLINE=1 for a build that is never shipped.',
      message: 'you are not logged in, and a build in CI must name its channel',
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

/**
 * `hotcodepush.json` lists public keys and neither `--private-key-path` nor `HOTCODEPUSH_SIGNING_KEY` gives the private key:
 * the app releases only signed bundles, so the upload stops before a byte moves.
 */
export class SigningKeyUnavailableError extends CliError {
  constructor() {
    super({
      code: 'E_SIGNING_KEY_UNAVAILABLE',
      exitCode: ExitCode.Error,
      fix: 'pass --private-key-path with the file "hotcodepush signing-key create" wrote, or set HOTCODEPUSH_SIGNING_KEY to its content.',
      message: `${PROJECT_CONFIG_FILE_NAME} lists public keys and no private key is given to sign with`,
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
 * An answer outside the API's shape, a proxy's error page or a body without the catalog's code, from either client:
 * the typed client reports it as `E_UNEXPECTED_RESPONSE`, Better Auth's client as an error without a code.
 */
export class UnexpectedResponseError extends CliError {
  constructor(status: number) {
    super({
      code: 'E_UNEXPECTED_RESPONSE',
      exitCode: ExitCode.Error,
      fix: `check the API URL in config.json and the network, and report it at ${ISSUES_URL} if it persists.`,
      message: `the API answered ${status} outside its shape`,
    });
  }
}

/**
 * An Xcode project the CLI cannot edit: unparseable, or without the group or the phase its edit attaches to.
 * The fix is the edit by hand, the resource reference a Capacitor project takes unless another is named.
 */
export class XcodeProjectError extends CliError {
  constructor(
    message: string,
    cause: unknown,
    projectFilePath: string,
    fix = `add hotcodepush.json to the app target's Copy Bundle Resources in ${projectFilePath}.`,
  ) {
    super({
      cause,
      code: 'E_XCODE_PROJECT',
      exitCode: ExitCode.Error,
      fix,
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
