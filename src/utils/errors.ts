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

export interface DeviceAuthorizationPrompt {
  userCode: string;
  verificationUrl: string;
}

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

// Organizations can share a name, and so can apps of different organizations.
export class AmbiguousNameError extends CliError {
  constructor(noun: string, name: string, source = `--${noun}`) {
    super({
      code: 'invalid_parameter',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: `Pass the id instead, as "hotcodepush ${noun} list" prints it.`,
      message: `Several ${noun}s carry the name "${name}" from ${source}.`,
    });
  }
}

// The message from the API carries its own fix.
// A 401 means the token is no longer valid, so the exit code is 3.
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

// Checked before any upload, so no upload is wasted on a refusal from the API.
export class BundleTooLargeError extends CliError {
  constructor(what: string, bundleBytesLimit: number) {
    super({
      code: 'bundle_too_large',
      exitCode: ExitCode.Error,
      fix: 'A file or a bundle is at most 512 MB. Move large media out of the web build.',
      message: `${what} is above the limit of ${bundleBytesLimit} bytes.`,
    });
  }
}

export class CommandFailedError extends CliError {
  constructor(commandLine: string, exitCode: number | null) {
    super({
      code: 'command_failed',
      exitCode: ExitCode.Error,
      fix: 'Run it by hand and read its output.',
      message: `The command "${commandLine}" exited with ${exitCode ?? 'a signal'}.`,
    });
  }
}

export class ConfirmationRequiredError extends CliError {
  constructor(consequence: string, fix = 'Pass --yes to confirm.') {
    super({
      code: 'confirmation_required',
      exitCode: ExitCode.ConfirmationRequired,
      fix,
      message: `A confirmation is required. This ${consequence}.`,
    });
  }
}

// A build without a fingerprint would match binaries it does not describe.
// The fix is the message of the protocol package as it stands.
export class FingerprintUnavailableError extends CliError {
  constructor(cause: Error) {
    super({
      cause,
      code: 'fingerprint_unavailable',
      exitCode: ExitCode.Error,
      fix: cause.message,
      message: 'The fingerprint cannot be computed.',
    });
  }
}

// Never names the file content, since `config.json` can hold the token.
export class InvalidJsonError extends CliError {
  constructor(filePath: string, problem: string) {
    super({
      code: 'invalid_json',
      exitCode: ExitCode.Error,
      fix: 'Correct the JSON in that file and run the command again.',
      message: `The file ${filePath} is not valid JSON. ${problem}.`,
    });
  }
}

export class InvalidParameterError extends CliError {
  constructor(
    message: string,
    fix = 'Run the command with --help to see its options.',
    cause?: unknown,
  ) {
    super({
      cause,
      code: 'invalid_parameter',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix,
      message,
    });
  }
}

export class LoginDeniedError extends CliError {
  constructor() {
    super({
      code: 'login_denied',
      exitCode: ExitCode.Error,
      fix: 'Run "hotcodepush login" again to approve it.',
      message: 'The login was denied in the browser.',
    });
  }
}

export class LoginExpiredError extends CliError {
  constructor() {
    super({
      code: 'login_expired',
      exitCode: ExitCode.Error,
      fix: 'Run "hotcodepush login" again and approve the code before it expires.',
      message: 'The login code expired before it was approved.',
    });
  }
}

export class MissingParameterError extends CliError {
  constructor(
    flag: string,
    fix = `Pass ${flag}, or run the command interactively to be asked for it.`,
  ) {
    super({
      code: 'missing_parameter',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix,
      message: `No value was given for ${flag}.`,
    });
  }
}

export class NativeProjectError extends CliError {
  constructor(message: string, fix: string) {
    super({
      code: 'native_project',
      exitCode: ExitCode.Error,
      fix,
      message,
    });
  }
}

// From a login that cannot wait for the approval, the fix carries the page and the code for an agent to relay.
export class NotLoggedInError extends CliError {
  constructor(deviceAuthorizationPrompt?: DeviceAuthorizationPrompt) {
    super({
      code: 'not_logged_in',
      exitCode: ExitCode.NotLoggedIn,
      fix: deviceAuthorizationPrompt
        ? `Approve at ${deviceAuthorizationPrompt.verificationUrl} with code ${deviceAuthorizationPrompt.userCode}, then run "hotcodepush login" again.`
        : 'Run "hotcodepush login" or set HOTCODEPUSH_TOKEN.',
      message: 'You are not logged in.',
    });
  }
}

// A shipped build must name its channel, so CI fails where a local build goes on offline.
export class PipelineNotLoggedInError extends CliError {
  constructor() {
    super({
      code: 'not_logged_in',
      exitCode: ExitCode.NotLoggedIn,
      fix: 'Set HOTCODEPUSH_TOKEN in the pipeline, or HOTCODEPUSH_OFFLINE=1 for a build that is never shipped.',
      message:
        'You are not logged in, and a build in CI must name its channel.',
    });
  }
}

// The command printed its outcome itself, so the entry point prints nothing more.
// The stopped step of `init` goes into its telemetry event.
export class ReportedFailureError extends CliError {
  readonly stoppedStep: string | undefined;

  constructor(code: string, stoppedStep?: string) {
    super({
      code,
      exitCode: ExitCode.Error,
      fix: null,
      message: 'Reported above.',
    });
    this.stoppedStep = stoppedStep;
  }
}

// The app accepts only signed bundles, so the upload stops before any byte moves.
export class SigningKeyUnavailableError extends CliError {
  constructor() {
    super({
      code: 'signing_key_unavailable',
      exitCode: ExitCode.Error,
      fix: 'Pass --private-key-path with the file "hotcodepush signing-key create" wrote, or set HOTCODEPUSH_SIGNING_KEY to its content.',
      message: `No private key is given to sign with, and ${PROJECT_CONFIG_FILE_NAME} lists public keys.`,
    });
  }
}

export class UnexpectedError extends CliError {
  constructor(cause: unknown) {
    super({
      cause,
      code: 'unexpected',
      exitCode: ExitCode.Error,
      fix: `Run the command again with --verbose, and report it at ${ISSUES_URL} if it persists.`,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

// A proxy error page or a body without a catalog code.
// The typed client keeps its error as the cause; the Better Auth client gives an error without a code.
export class UnexpectedResponseError extends CliError {
  constructor(status: number, cause?: unknown) {
    super({
      cause,
      code: 'unexpected_response',
      exitCode: ExitCode.Error,
      fix: `Check the API URL in config.json and the network, and report it at ${ISSUES_URL} if it persists.`,
      message: `The API answered with status ${status} in an unexpected shape.`,
    });
  }
}

export class XcodeProjectError extends CliError {
  constructor(
    message: string,
    cause: unknown,
    projectFilePath: string,
    fix = `Add the build phase to the app target in ${projectFilePath} by hand.`,
  ) {
    super({
      cause,
      code: 'xcode_project',
      exitCode: ExitCode.Error,
      fix,
      message,
    });
  }
}

export class UnknownFrameworkError extends CliError {
  constructor() {
    super({
      code: 'unknown_framework',
      exitCode: ExitCode.Error,
      fix: 'Run it in a project with react-native, expo, @capacitor/core or cordova among its dependencies.',
      message: 'No supported framework was found in package.json.',
    });
  }
}

export class UnknownCommandError extends CliError {
  constructor(typedCommand: string, closestCommandName: string | undefined) {
    super({
      code: 'unknown_command',
      exitCode: ExitCode.Error,
      fix: closestCommandName
        ? `Did you mean "${closestCommandName}"?`
        : 'Run "hotcodepush --help" to list the commands.',
      message: `There is no command "${typedCommand}".`,
    });
  }
}

// An unknown id is the API's own `not_found` instead.
export class UnknownNameError extends CliError {
  constructor(noun: string, name: string, source = `--${noun}`) {
    super({
      code: 'invalid_parameter',
      exitCode: ExitCode.MissingOrInvalidParameter,
      fix: `Run "hotcodepush ${noun} list" to see the names.`,
      message: `The ${noun} "${name}" from ${source} does not exist.`,
    });
  }
}
