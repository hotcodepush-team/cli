import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  INIT_MANUAL_STEP,
  REACT_NATIVE_PACKAGE_NAME,
  REACT_NATIVE_PACKAGE_SPEC,
} from '../../config/consts.js';
import type { CliError, ConfirmationRequiredError } from '../errors.js';
import { NativeProjectError, XcodeProjectError } from '../errors.js';
import type { StepOutcome } from '../init-steps.js';
import { runCommandLineVisibly } from '../package-manager.js';
import type { ReactNativeEdit } from '../react-native-project.js';
import {
  resolveBundleUrlEdit,
  resolveGradleEdit,
  resolveProtocolPodEdit,
  resolveReactHostEdit,
} from '../react-native-project.js';
import type { Platform } from '../upload.js';
import {
  addBinaryCreatePhase,
  hasBinaryCreatePhase,
  resolveXcodeProjectFilePath,
} from '../xcode-project.js';
import type { NativeProjects } from './native-projects.js';
import { resolveNativeProjects } from './native-projects.js';
import {
  collectEmbeddedFiles,
  packageReactNativeBundles,
  readBinaryIdentity,
  resolveMainBundlePath,
  resolveNativeProjectPaths,
} from './react-native-build.js';
import {
  checkSdkPackage,
  installSdkPackage,
  isSdkPackageDeclared,
} from './sdk-package.js';
import type {
  FrameworkCheck,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
  NativeProjectPaths,
  WiringOptions,
} from './index.js';

const BINARY_CREATE_PHASE_DESCRIPTION =
  'the Create HotCodePush binary phase in Xcode';

const POD_NAME = 'HotcodepushReactNativeCodePush';

/**
 * React Native: no build output in the project, since each platform's JavaScript is bundled when it is needed — by the
 * native build, whose Xcode phase and Gradle task run binary create on what it bundled, and by the upload, one bundle
 * per platform. The app hands React Native the bundle the SDK serves, one line in `AppDelegate.swift` and one in `MainApplication.kt`.
 */
export const reactNativeFramework: FrameworkModule = {
  binaryCreateStep: 'build the app natively, which runs binary create',
  packageName: REACT_NATIVE_PACKAGE_NAME,
  versionedPackageNames: ['react-native', REACT_NATIVE_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, REACT_NATIVE_PACKAGE_NAME),
    checkBinaryCreateStep(project),
    checkBundleWiring(project),
  ],
  collectEmbeddedFiles,
  packageBundles: request =>
    packageReactNativeBundles(request, resolveBundlerArgs),
  readBinaryIdentity,
  readBuildDirectory: () => undefined,
  resolveMainBundlePath,
  resolveNativeProjectPaths,
  resolveResourceFilePath: () => undefined,
  resolveWiring,
};

/**
 * `doctor`'s `host` row: both native apps ask the SDK for the bundle React Native runs.
 */
function checkBundleWiring({
  directoryPath,
}: FrameworkProject): FrameworkCheck {
  return checkEdits(
    'host',
    'React Native runs the bundle the SDK serves',
    resolveBundleWiringEdits(resolveNativeProjectPaths(directoryPath)),
    directoryPath,
  );
}

/**
 * A row over edits: ok when every one is in its file, failed naming the files that lack theirs, skipped without a native project.
 */
function checkEdits(
  check: string,
  wiredMessage: string,
  edits: ReactNativeEdit[],
  projectDirectoryPath: string,
  isPhaseMissing = false,
): FrameworkCheck {
  const missingFilePaths = edits
    .filter(edit => !edit.isApplied())
    .map(({ filePath }) => relative(projectDirectoryPath, filePath));
  if (edits.length === 0 && !isPhaseMissing) {
    return { check, message: 'no native project to check', status: 'skipped' };
  }
  if (missingFilePaths.length > 0 || isPhaseMissing) {
    return {
      check,
      manualStep: INIT_MANUAL_STEP,
      message: `not wired in ${[...(isPhaseMissing ? ['the Xcode project'] : []), ...missingFilePaths].join(' and ')}`,
      status: 'failed',
    };
  }
  return { check, message: wiredMessage, status: 'ok' };
}

/**
 * `doctor`'s `hook` row: the Xcode phase and the Gradle line that run binary create.
 */
function checkBinaryCreateStep({
  directoryPath,
}: FrameworkProject): FrameworkCheck {
  const nativeProjectPaths = resolveNativeProjectPaths(directoryPath);
  const xcodeProjectFilePath = resolveXcodeProjectFilePath(
    nativeProjectPaths.ios,
  );
  const gradleEdit = resolveGradleEdit(nativeProjectPaths.android);
  if (xcodeProjectFilePath === undefined && gradleEdit === undefined) {
    return {
      check: 'hook',
      message: 'no native project to check',
      status: 'skipped',
    };
  }
  return checkEdits(
    'hook',
    'the Xcode phase and the Gradle task run binary create',
    gradleEdit === undefined ? [] : [gradleEdit],
    directoryPath,
    xcodeProjectFilePath !== undefined &&
      !hasBinaryCreatePhase(xcodeProjectFilePath),
  );
}

/**
 * Whether the SDK's pod is among the installed ones; without a Podfile there is nothing to install.
 */
function isPodInstalled(iosProjectPath: string): boolean {
  if (!existsSync(join(iosProjectPath, 'Podfile'))) {
    return true;
  }
  const lockFilePath = join(iosProjectPath, 'Podfile.lock');
  return (
    existsSync(lockFilePath) &&
    readFileSync(lockFilePath, 'utf8').includes(POD_NAME)
  );
}

/**
 * The edits that make both native apps ask the SDK for their bundle, for the native projects that exist.
 */
function resolveBundleWiringEdits(
  nativeProjectPaths: NativeProjectPaths,
): ReactNativeEdit[] {
  return [
    resolveBundleUrlEdit(nativeProjectPaths.ios),
    resolveReactHostEdit(nativeProjectPaths.android),
  ].filter(edit => edit !== undefined);
}

/**
 * `react-native bundle` from `index.<platform>.js` where the project has one, `index.js` otherwise, the rule of React
 * Native's own builds.
 */
function resolveBundlerArgs(
  projectDirectoryPath: string,
  platform: Platform,
): string[] {
  const platformEntryFileName = `index.${platform}.js`;
  return [
    'react-native',
    'bundle',
    '--entry-file',
    existsSync(join(projectDirectoryPath, platformEntryFileName))
      ? platformEntryFileName
      : 'index.js',
  ];
}

/**
 * Every line `init` adds to the native projects besides the Xcode phase, in the order it adds them.
 */
function resolveEdits(
  projectDirectoryPath: string,
  nativeProjectPaths: NativeProjectPaths,
): ReactNativeEdit[] {
  return [
    resolveGradleEdit(nativeProjectPaths.android),
    ...resolveBundleWiringEdits(nativeProjectPaths),
    resolveProtocolPodEdit(nativeProjectPaths.ios, projectDirectoryPath),
  ].filter(edit => edit !== undefined);
}

async function resolveWiring(
  { directoryPath, packageJson }: FrameworkProject,
  options: WiringOptions,
): Promise<FrameworkWiring> {
  const nativeProjects = await resolveNativeProjects(
    directoryPath,
    resolveNativeProjectPaths(directoryPath),
    options,
    '',
  );
  const isPackageInstalled = isSdkPackageDeclared(
    packageJson,
    REACT_NATIVE_PACKAGE_NAME,
  );
  const xcodeProjectFilePath = resolveXcodeProjectFilePath(nativeProjects.ios);
  return {
    isPackageInstalled,
    nativeFilePaths: [
      ...(xcodeProjectFilePath === undefined ||
      hasBinaryCreatePhase(xcodeProjectFilePath)
        ? []
        : [xcodeProjectFilePath]),
      ...resolveEdits(directoryPath, nativeProjects)
        .filter(edit => !edit.isApplied())
        .map(({ filePath }) => filePath),
    ].map(filePath => relative(directoryPath, filePath)),
    packageFilePaths: isPackageInstalled ? [] : ['package.json'],
    installPackage: () =>
      installSdkPackage(
        directoryPath,
        REACT_NATIVE_PACKAGE_NAME,
        REACT_NATIVE_PACKAGE_SPEC,
      ),
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
 * The Xcode phase, the Gradle line, the bundle wiring of both apps and the pod, each left alone when present, then
 * `pod install` where the SDK's pod is not installed yet. An edit a file has no place for does not hold the others back:
 * they are made, and the step stops with the first one's manual step.
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
  const isPhaseWired =
    xcodeProjectFilePath === undefined ||
    hasBinaryCreatePhase(xcodeProjectFilePath);
  const pendingEdits = resolveEdits(
    projectDirectoryPath,
    nativeProjects,
  ).filter(edit => !edit.isApplied());
  const arePodsInstalled = isPodInstalled(nativeProjects.ios);
  if (isPhaseWired && pendingEdits.length === 0 && arePodsInstalled) {
    return {
      message: 'binary create and the bundle wiring already wired',
      status: 'skipped',
      value: undefined,
    };
  }
  if (editBlocker !== undefined && (!isPhaseWired || pendingEdits.length > 0)) {
    throw editBlocker;
  }
  const errors: CliError[] = [];
  const wired: string[] = [];
  if (xcodeProjectFilePath !== undefined && !isPhaseWired) {
    try {
      await addBinaryCreatePhase(xcodeProjectFilePath, options);
      wired.push(BINARY_CREATE_PHASE_DESCRIPTION);
    } catch (error) {
      errors.push(assertEditError(error));
    }
  }
  for (const edit of pendingEdits) {
    try {
      edit.apply();
      wired.push(edit.description);
    } catch (error) {
      errors.push(assertEditError(error));
    }
  }
  const [firstError] = errors;
  if (firstError !== undefined) {
    throw firstError;
  }
  if (!arePodsInstalled) {
    runCommandLineVisibly(
      { args: ['install'], command: 'pod' },
      nativeProjects.ios,
    );
    wired.push('the pods through pod install');
  }
  return {
    message: `wired ${wired.join(', ')}`,
    status: 'done',
    value: undefined,
  };
}

/**
 * An edit that found no place in its file is collected as the step's manual step; anything else is not the edit's to explain.
 */
function assertEditError(error: unknown): CliError {
  if (
    error instanceof NativeProjectError ||
    error instanceof XcodeProjectError
  ) {
    return error;
  }
  throw error;
}
