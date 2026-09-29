import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandFailedError } from './errors.js';
import {
  resolveCommandLineText,
  resolveInstallCommandLine,
  resolvePackageManager,
  resolveRunScriptCommandLine,
  runCommandLineVisibly,
} from './package-manager.js';

describe('package-manager', () => {
  const directoryPaths: string[] = [];

  function writeProject(lockfileName?: string): string {
    const directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-pm-'));
    directoryPaths.push(directoryPath);
    if (lockfileName !== undefined) {
      writeFileSync(join(directoryPath, lockfileName), '');
    }
    return directoryPath;
  }

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  it('should detect the package manager from the lockfile, npm without one', () => {
    expect(resolvePackageManager(writeProject())).toBe('npm');
    expect(resolvePackageManager(writeProject('package-lock.json'))).toBe(
      'npm',
    );
    expect(resolvePackageManager(writeProject('yarn.lock'))).toBe('yarn');
    expect(resolvePackageManager(writeProject('pnpm-lock.yaml'))).toBe('pnpm');
    expect(resolvePackageManager(writeProject('bun.lock'))).toBe('bun');
  });

  it('should phrase the exact install and the script run in each manager', () => {
    expect(
      resolveCommandLineText(resolveInstallCommandLine('npm', 'pkg@1')),
    ).toBe('npm install --save-exact pkg@1');
    expect(
      resolveCommandLineText(resolveInstallCommandLine('yarn', 'pkg@1')),
    ).toBe('yarn add --exact pkg@1');
    expect(
      resolveCommandLineText(resolveInstallCommandLine('pnpm', 'pkg@1')),
    ).toBe('pnpm add --save-exact pkg@1');
    expect(
      resolveCommandLineText(resolveInstallCommandLine('bun', 'pkg@1')),
    ).toBe('bun add --exact pkg@1');
    expect(
      resolveCommandLineText(resolveRunScriptCommandLine('npm', 'build')),
    ).toBe('npm run build');
    expect(
      resolveCommandLineText(resolveRunScriptCommandLine('yarn', 'build')),
    ).toBe('yarn build');
  });

  it('should run a command in the project and turn a failure into E_COMMAND_FAILED', () => {
    const directoryPath = writeProject();

    expect(() =>
      runCommandLineVisibly(
        { args: ['-e', 'process.exit(0)'], command: 'node' },
        directoryPath,
      ),
    ).not.toThrow();
    expect(() =>
      runCommandLineVisibly(
        { args: ['-e', 'process.exit(3)'], command: 'node' },
        directoryPath,
      ),
    ).toThrow(CommandFailedError);
  });
});
