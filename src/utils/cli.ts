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

interface CommandLineRun {
  cliError: CliError | undefined;
  commandName: string | undefined;
}

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
  // The check runs beside the command, so the notice after it never waits long on the registry.
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

// A shell profile runs `completion` at startup, so it must not wait on the network or print a notice.
function isShellStartup(argv: string[]): boolean {
  return argv[0] === 'completion';
}

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
    // A line without a command shows the help or the version, and zodline ends the process there.
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

// zodline always colours its help, so the colour codes are stripped while it runs.
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
