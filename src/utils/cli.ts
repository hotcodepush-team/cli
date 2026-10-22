import { stripVTControlCharacters } from 'node:util';
import type { DefineConfig } from 'zodline';
import { defineConfig, processConfig } from 'zodline';
import type { CommandRegistry } from './command-registry.js';
import { loadCommands, resolveInvocation } from './command-registry.js';
import { isColorEnabled } from './environment.js';
import { printError, resolveCliError } from './error-mapping.js';
import type { CliError } from './errors.js';
import { ExitCode, ReportedFailureError } from './errors.js';
import { printTelemetryNotice, reportFinishedCommand } from './telemetry.js';
import {
  printUpdateNotice,
  refreshLatestKnownVersion,
} from './update-notice.js';

export interface CliMeta {
  description: string;
  name: string;
  version: string;
}

/**
 * A command line once run: the one command it named, none for an unknown one, and the error it ended with.
 */
interface CommandLineRun {
  cliError: CliError | undefined;
  commandName: string | undefined;
}

/**
 * Runs one command line and returns its exit code.
 * The one place that maps a thrown error to its message and exit code; commands throw and never exit.
 * It reports the finished command to telemetry, after the notice the first run on a machine prints,
 * and checks for a newer version beside the command, its notice last; a shell start does neither.
 */
export async function runCli(
  commandRegistry: CommandRegistry,
  argv: string[],
  meta: CliMeta,
): Promise<ExitCode> {
  if (isShellStartup(argv)) {
    const { cliError } = await runCommandLine(commandRegistry, argv, meta);
    printCommandLineError(cliError, argv);
    return cliError?.exitCode ?? ExitCode.Success;
  }
  const startedAt = performance.now();
  printTelemetryNotice();
  // the daily check runs beside the command, so the notice after it never waits on the registry for long
  const latestKnownVersionRefresh = refreshLatestKnownVersion();
  const { cliError, commandName } = await runCommandLine(
    commandRegistry,
    argv,
    meta,
  );
  printCommandLineError(cliError, argv);
  if (commandName !== undefined) {
    await reportFinishedCommand({
      cliError,
      commandName,
      durationMs: performance.now() - startedAt,
    });
  }
  await latestKnownVersionRefresh;
  printUpdateNotice();
  return cliError?.exitCode ?? ExitCode.Success;
}

/**
 * `completion` runs as a shell starts, from the line in its profile, so it must not wait on the network or print a notice.
 */
function isShellStartup(argv: string[]): boolean {
  return argv[0] === 'completion';
}

/**
 * The error's message, unless the command reported its failure itself.
 */
function printCommandLineError(
  cliError: CliError | undefined,
  argv: string[],
): void {
  if (cliError !== undefined && !(cliError instanceof ReportedFailureError)) {
    printError(cliError, {
      isJson: argv.includes('--json'),
      isVerbose: argv.includes('--verbose'),
    });
  }
}

async function runCommandLine(
  commandRegistry: CommandRegistry,
  argv: string[],
  meta: CliMeta,
): Promise<CommandLineRun> {
  let commandName: string | undefined;
  try {
    const invocation = resolveInvocation(Object.keys(commandRegistry), argv);
    // a line that names no command shows the help or the version, and zodline ends the process there
    commandName =
      invocation.commandNames.length === 1
        ? invocation.commandNames[0]
        : undefined;
    const commands = await loadCommands(
      commandRegistry,
      invocation.commandNames,
    );
    const config = defineConfig({ commands, meta });
    const { args, command, options } = isColorEnabled(process.stdout)
      ? processConfig(config, invocation.argv)
      : processConfigWithoutColor(config, invocation.argv);
    await command.action(options, args);
    return { cliError: undefined, commandName };
  } catch (error) {
    return { cliError: resolveCliError(error), commandName };
  }
}

/**
 * zodline colours its help unconditionally, so its output loses the colour codes while zodline processes the command line.
 */
function processConfigWithoutColor(config: DefineConfig, argv: string[]) {
  const log = console.log;
  console.log = (...values: unknown[]) =>
    log(
      ...values.map(value =>
        typeof value === 'string' ? stripVTControlCharacters(value) : value,
      ),
    );
  try {
    return processConfig(config, argv);
  } finally {
    console.log = log;
  }
}
