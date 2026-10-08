import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { INIT_MANUAL_STEP } from '../../config/consts.js';
import type { PackageJson } from '../package-json.js';
import {
  resolveInstallCommandLine,
  resolvePackageManager,
  runCommandLineVisibly,
} from '../package-manager.js';
import type { FrameworkCheck, FrameworkProject } from './index.js';

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
      manualStep: INIT_MANUAL_STEP,
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
  return readPackageJsonVersion(packageJsonPath);
}

function readPackageJsonVersion(packageJsonPath: string): string | undefined {
  return (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson)
    .version;
}

/**
 * The version of a package the SDK package depends on, resolved from the SDK package as Node resolves it, since an
 * isolated install such as pnpm's keeps it out of the project's `node_modules`; none when either is not installed.
 */
export function readSdkDependencyVersion(
  projectDirectoryPath: string,
  sdkPackageName: string,
  packageName: string,
): string | undefined {
  try {
    const projectRequire = createRequire(
      join(projectDirectoryPath, 'package.json'),
    );
    const sdkPackageJsonPath = projectRequire.resolve(
      `${sdkPackageName}/package.json`,
    );
    return readPackageJsonVersion(
      projectRequire.resolve(`${packageName}/package.json`, {
        paths: [dirname(sdkPackageJsonPath)],
      }),
    );
  } catch {
    return undefined;
  }
}
