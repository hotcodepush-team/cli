import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CAPACITOR_PACKAGE_NAME,
  CAPACITOR_PACKAGE_SPEC,
  BINARY_CREATE_HOOK_COMMAND,
  BINARY_CREATE_HOOK_NAME,
} from '../../config/consts.js';
import {
  readPackageJson,
  resolveBinaryCreateHookState,
  wireBinaryCreateHook,
} from '../binary-create-hook.js';
import { readBinaryIdentity as readNativeProjectBinaryIdentity } from '../binary-identity.js';
import type { ConfirmationRequiredError } from '../errors.js';
import type { StepOutcome } from '../init-steps.js';
import {
  resolveInstallCommandLine,
  resolvePackageManager,
  runCommandLineVisibly,
} from '../package-manager.js';
import type { Platform } from '../upload.js';
import {
  addResourceReference,
  hasResourceReference,
  resolveXcodeProjectFilePath,
} from '../xcode-project.js';
import type { NativeProjects } from './native-projects.js';
import { resolveNativeProjects } from './native-projects.js';
import { checkSdkPackage, isSdkPackageDeclared } from './sdk-package.js';
import type {
  FrameworkCheck,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
  NativeProjectPaths,
  WiringOptions,
} from './index.js';

export const CAPACITOR_CONFIG_FILE_NAMES = [
  'capacitor.config.json',
  'capacitor.config.ts',
];

const INIT_STEP = 'run hotcodepush init';

/**
 * Capacitor: the web build at `webDir`, the native projects at `ios/` and `android/`, binary create in the
 * `capacitor:copy:after` script and the resource file referenced by the iOS project.
 */
export const capacitorFramework: FrameworkModule = {
  binaryCreateStep: 'run npx cap sync, which runs binary create',
  packageName: CAPACITOR_PACKAGE_NAME,
  versionedPackageNames: ['@capacitor/core', CAPACITOR_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, CAPACITOR_PACKAGE_NAME),
    checkHook(project),
    checkXcodeProject(project),
  ],
  readBinaryIdentity: (platform, projectDirectoryPath) =>
    readNativeProjectBinaryIdentity(
      platform,
      resolveNativeProjectPaths(projectDirectoryPath)[platform],
    ),
  readBuildDirectory: readWebDir,
  resolveNativeProjectPaths,
  resolveResourceFilePath,
  resolveWiring,
};

function checkHook({ packageJson }: FrameworkProject): FrameworkCheck {
  const state =
    packageJson === undefined
      ? 'absent'
      : resolveBinaryCreateHookState(packageJson);
  switch (state) {
    case 'wired':
      return {
        check: 'hook',
        message: `${BINARY_CREATE_HOOK_NAME} runs binary create`,
        status: 'ok',
      };
    case 'unparseable':
      return {
        check: 'hook',
        manualStep: `add "${BINARY_CREATE_HOOK_COMMAND}" to the ${BINARY_CREATE_HOOK_NAME} script by hand`,
        message: `${BINARY_CREATE_HOOK_NAME} runs a script without binary create`,
        status: 'failed',
      };
    default:
      return {
        check: 'hook',
        manualStep: INIT_STEP,
        message: `${BINARY_CREATE_HOOK_NAME} does not run binary create`,
        status: 'failed',
      };
  }
}

function checkXcodeProject({
  directoryPath,
}: FrameworkProject): FrameworkCheck {
  const iosProjectPath = resolveNativeProjectPaths(directoryPath).ios;
  const projectFilePath = resolveXcodeProjectFilePath(iosProjectPath);
  if (projectFilePath === undefined) {
    return {
      check: 'ios-project',
      message: `no iOS project at ${relative(directoryPath, iosProjectPath)}`,
      status: 'skipped',
    };
  }
  try {
    return hasResourceReference(projectFilePath)
      ? {
          check: 'ios-project',
          message: 'the app target copies hotcodepush.json into the bundle',
          status: 'ok',
        }
      : {
          check: 'ios-project',
          manualStep: INIT_STEP,
          message: 'the app target does not copy hotcodepush.json',
          status: 'failed',
        };
  } catch (error) {
    return {
      check: 'ios-project',
      manualStep:
        "add hotcodepush.json to the app target's Copy Bundle Resources in Xcode",
      message: error instanceof Error ? error.message : String(error),
      status: 'failed',
    };
  }
}

/**
 * Whether the reference is there; a project the CLI cannot read counts as one to change, and the hook step says why.
 */
function hasReadableResourceReference(xcodeProjectFilePath: string): boolean {
  try {
    return hasResourceReference(xcodeProjectFilePath);
  } catch {
    return false;
  }
}

function installPackage(projectDirectoryPath: string): string {
  runCommandLineVisibly(
    resolveInstallCommandLine(
      resolvePackageManager(projectDirectoryPath),
      CAPACITOR_PACKAGE_SPEC,
    ),
    projectDirectoryPath,
  );
  return `installed ${CAPACITOR_PACKAGE_NAME} from ${CAPACITOR_PACKAGE_SPEC}`;
}

/**
 * The text of `capacitor.config.json` or `.ts`, read as text since the TypeScript form is code: the values are matched, never evaluated.
 */
function readCapacitorConfig(projectDirectoryPath: string): string | undefined {
  for (const fileName of CAPACITOR_CONFIG_FILE_NAMES) {
    const filePath = join(projectDirectoryPath, fileName);
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf8');
    }
  }
  return undefined;
}

function readConfigValue(
  configText: string | undefined,
  pattern: RegExp,
): string | undefined {
  return configText === undefined ? undefined : pattern.exec(configText)?.[1];
}

/**
 * Capacitor's `webDir`, the web build binary create hashes.
 */
function readWebDir(projectDirectoryPath: string): string | undefined {
  return readConfigValue(
    readCapacitorConfig(projectDirectoryPath),
    /webDir['"]?\s*:\s*['"]([^'"]+)['"]/,
  );
}

/**
 * `ios.path` and `android.path` of `capacitor.config`, or `ios/` and `android/` beside `package.json`.
 */
function resolveNativeProjectPaths(
  projectDirectoryPath: string,
): NativeProjectPaths {
  const capacitorConfig = readCapacitorConfig(projectDirectoryPath);
  return {
    android: join(
      projectDirectoryPath,
      readConfigValue(
        capacitorConfig,
        /android:\s*\{[^}]*?path:\s*['"]([^'"]+)['"]/,
      ) ?? 'android',
    ),
    ios: join(
      projectDirectoryPath,
      readConfigValue(
        capacitorConfig,
        /ios:\s*\{[^}]*?path:\s*['"]([^'"]+)['"]/,
      ) ?? 'ios',
    ),
  };
}

/**
 * Where each platform's native project reads the file: the app bundle's resources on iOS, the assets on Android.
 */
function resolveResourceFilePath(
  platform: Platform,
  nativeProjectPath: string,
): string {
  return platform === 'ios'
    ? join(nativeProjectPath, 'App', 'App', 'hotcodepush.json')
    : join(
        nativeProjectPath,
        'app',
        'src',
        'main',
        'assets',
        'hotcodepush.json',
      );
}

async function resolveWiring(
  { directoryPath, packageJson }: FrameworkProject,
  options: WiringOptions,
): Promise<FrameworkWiring> {
  const nativeProjects = await resolveNativeProjects(
    directoryPath,
    resolveNativeProjectPaths(directoryPath),
    options,
    'run "npx cap add ios" and "npx cap add android", or ',
  );
  const xcodeProjectFilePath = resolveXcodeProjectFilePath(nativeProjects.ios);
  const isPackageInstalled = isSdkPackageDeclared(
    packageJson,
    CAPACITOR_PACKAGE_NAME,
  );
  return {
    isPackageInstalled,
    nativeFilePaths:
      xcodeProjectFilePath !== undefined &&
      !hasReadableResourceReference(xcodeProjectFilePath)
        ? [relative(directoryPath, xcodeProjectFilePath)]
        : [],
    packageFilePaths:
      !isPackageInstalled ||
      resolveBinaryCreateHookState(packageJson ?? {}) !== 'wired'
        ? ['package.json']
        : [],
    installPackage: () => installPackage(directoryPath),
    wireBinaryCreateStep: editBlocker =>
      wireBinaryCreateStep(
        directoryPath,
        nativeProjects,
        xcodeProjectFilePath,
        editBlocker,
        options,
      ),
  };
}

/**
 * The binary create command in the `capacitor:copy:after` script and the resource reference in the iOS project, each left alone when present.
 */
async function wireBinaryCreateStep(
  projectDirectoryPath: string,
  nativeProjects: NativeProjects,
  xcodeProjectFilePath: string | undefined,
  editBlocker: ConfirmationRequiredError | undefined,
  options: WiringOptions,
): Promise<StepOutcome<undefined>> {
  if (nativeProjects.missingError !== undefined) {
    throw nativeProjects.missingError;
  }
  const isHookWired =
    resolveBinaryCreateHookState(readPackageJson(projectDirectoryPath)) ===
    'wired';
  const isReferencePresent =
    xcodeProjectFilePath === undefined ||
    hasReadableResourceReference(xcodeProjectFilePath);
  if (isHookWired && isReferencePresent) {
    return {
      message: `${BINARY_CREATE_HOOK_NAME} and the iOS resource reference already wired`,
      status: 'skipped',
      value: undefined,
    };
  }
  if (editBlocker !== undefined) {
    throw editBlocker;
  }
  const wired: string[] = [];
  if (wireBinaryCreateHook(projectDirectoryPath) === 'wired') {
    wired.push(BINARY_CREATE_HOOK_NAME);
  }
  if (
    xcodeProjectFilePath !== undefined &&
    (await addResourceReference(xcodeProjectFilePath, options)) === 'added'
  ) {
    wired.push('the iOS resource reference');
  }
  return {
    message: `wired ${wired.join(' and ')}`,
    status: 'done',
    value: undefined,
  };
}
