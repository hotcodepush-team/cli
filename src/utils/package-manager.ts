import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CommandFailedError } from './errors.js';

export interface CommandLine {
  args: string[];
  command: string;
}

export type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

const LOCKFILES: [fileName: string, packageManager: PackageManager][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
];

/**
 * The package manager the project uses, from its lockfile; npm without one.
 */
export function resolvePackageManager(
  projectDirectoryPath: string,
): PackageManager {
  const detected = LOCKFILES.find(([fileName]) =>
    existsSync(join(projectDirectoryPath, fileName)),
  );
  return detected === undefined ? 'npm' : detected[1];
}

/**
 * The install of one package at an exact version or URL, in the manager's own words.
 */
export function resolveInstallCommandLine(
  packageManager: PackageManager,
  packageSpec: string,
): CommandLine {
  switch (packageManager) {
    case 'bun':
      return { args: ['add', '--exact', packageSpec], command: 'bun' };
    case 'npm':
      return {
        args: ['install', '--save-exact', packageSpec],
        command: 'npm',
      };
    case 'pnpm':
      return { args: ['add', '--save-exact', packageSpec], command: 'pnpm' };
    case 'yarn':
      return { args: ['add', '--exact', packageSpec], command: 'yarn' };
  }
}

export function resolveRunScriptCommandLine(
  packageManager: PackageManager,
  scriptName: string,
): CommandLine {
  return packageManager === 'yarn'
    ? { args: [scriptName], command: 'yarn' }
    : { args: ['run', scriptName], command: packageManager };
}

export function resolveCommandLineText({ args, command }: CommandLine): string {
  return [command, ...args].join(' ');
}

/**
 * Runs a command in the project with its output on stderr, so `--json` stdout stays data; a failure is the CLI's error.
 */
export function runCommandLineVisibly(
  commandLine: CommandLine,
  projectDirectoryPath: string,
): void {
  const commandLineText = resolveCommandLineText(commandLine);
  process.stderr.write(`$ ${commandLineText}\n`);
  const result = spawnSync(commandLine.command, commandLine.args, {
    cwd: projectDirectoryPath,
    shell: process.platform === 'win32',
    stdio: ['ignore', process.stderr, process.stderr],
  });
  if (result.status !== 0) {
    throw new CommandFailedError(commandLineText, result.status);
  }
}
