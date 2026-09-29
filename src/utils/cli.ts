import { stripVTControlCharacters } from 'node:util';
import type { DefineConfig } from 'zodline';
import { defineConfig, processConfig } from 'zodline';
import type { CommandRegistry } from './command-registry.js';
import { loadCommands, resolveInvocation } from './command-registry.js';
import { isColorEnabled } from './environment.js';
import { printError, resolveCliError } from './error-mapping.js';
import { ExitCode } from './errors.js';

export interface CliMeta {
  description: string;
  name: string;
  version: string;
}

/**
 * Runs one command line and returns its exit code.
 * The one place that maps a thrown error to its message and exit code; commands throw and never exit.
 */
export async function runCli(
  commandRegistry: CommandRegistry,
  argv: string[],
  meta: CliMeta,
): Promise<ExitCode> {
  try {
    const invocation = resolveInvocation(Object.keys(commandRegistry), argv);
    const commands = await loadCommands(
      commandRegistry,
      invocation.commandNames,
    );
    const config = defineConfig({ commands, meta });
    const { args, command, options } = isColorEnabled(process.stdout)
      ? processConfig(config, invocation.argv)
      : processConfigWithoutColor(config, invocation.argv);
    await command.action(options, args);
    return ExitCode.Success;
  } catch (error) {
    const cliError = resolveCliError(error);
    printError(cliError, {
      isJson: argv.includes('--json'),
      isVerbose: argv.includes('--verbose'),
    });
    return cliError.exitCode;
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
