import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageJson } from '../binary-create-hook.js';
import {
  resolveInstallCommandLine,
  resolvePackageManager,
  runCommandLineVisibly,
} from '../package-manager.js';
import type { FrameworkCheck, FrameworkProject } from './index.js';

const INIT_STEP = 'run hotcodepush init';

/**
 * The SDK package as `doctor` reports it: declared in `package.json` and present in `node_modules`.
 */
export function checkSdkPackage(
  { directoryPath, packageJson }: FrameworkProject,
  packageName: string,
): FrameworkCheck {
  if (!isSdkPackageDeclared(packageJson, packageName)) {
    return {
      check: 'package',
      manualStep: INIT_STEP,
      message: `${packageName} is not in package.json`,
      status: 'failed',
    };
  }
  const installedVersion = readInstalledPackageVersion(
    directoryPath,
    packageName,
  );
  if (installedVersion === undefined) {
    return {
      check: 'package',
      manualStep: 'install the dependencies',
      message: `${packageName} is declared but not in node_modules`,
      status: 'failed',
    };
  }
  return {
    check: 'package',
    message: `${packageName} ${installedVersion} installed`,
    status: 'ok',
  };
}

/**
 * Installs the SDK package from its pinned build with the project's package manager, visibly, and answers the sentence the step prints.
 */
export function installSdkPackage(
  projectDirectoryPath: string,
  packageName: string,
  packageSpec: string,
): string {
  runCommandLineVisibly(
    resolveInstallCommandLine(
      resolvePackageManager(projectDirectoryPath),
      packageSpec,
    ),
    projectDirectoryPath,
  );
  return `installed ${packageName} from ${packageSpec}`;
}

export function isSdkPackageDeclared(
  packageJson: PackageJson | undefined,
  packageName: string,
): boolean {
  return (
    packageJson?.dependencies?.[packageName] !== undefined ||
    packageJson?.devDependencies?.[packageName] !== undefined
  );
}

/**
 * The version of a package as `node_modules` holds it, none when it is not installed.
 */
export function readInstalledPackageVersion(
  projectDirectoryPath: string,
  packageName: string,
): string | undefined {
  const packageJsonPath = join(
    projectDirectoryPath,
    'node_modules',
    packageName,
    'package.json',
  );
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  return (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson)
    .version;
}
