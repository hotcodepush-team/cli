import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  REACT_NATIVE_PACKAGE_NAME,
  REACT_NATIVE_PACKAGE_SPEC,
} from '../../config/consts.js';
import type { ConfirmationRequiredError } from '../errors.js';
import type { StepOutcome } from '../init-steps.js';
import type { NativeProjectEdit } from '../native-project-edit.js';
import { resolveGradleEdit } from '../native-project-edit.js';
import { runCommandLineVisibly } from '../package-manager.js';
import {
  resolveBundleUrlEdit,
  resolveCorePodEdit,
  resolveReactHostEdit,
} from '../react-native-project.js';
import type { Platform } from '../upload.js';
import type { BinaryCreatePhase } from '../xcode-project.js';
import {
  hasBinaryCreatePhase,
  resolveXcodeProjectFilePath,
} from '../xcode-project.js';
import {
  applyNativeProjectEdits,
  checkBinaryCreateStep,
  checkEdits,
} from './binary-create-step.js';
import type { NativeProjects } from './native-projects.js';
import { resolveNativeProjects } from './native-projects.js';
import {
  collectEmbeddedFiles,
  packageReactNativeBundles,
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

/**
 * The phase runs the SDK package's script through React Native's `with-environment.sh`, which finds Node, right after
 * the bundling whose output binary create hashes.
 */
const BINARY_CREATE_PHASE: BinaryCreatePhase = {
  anchorPhaseName: 'Bundle React Native code and images',
  fix: `add a Run Script phase after "Bundle React Native code and images" that runs node_modules/${REACT_NATIVE_PACKAGE_NAME}/scripts/binary-create-xcode.sh through React Native's with-environment.sh.`,
  // the lines of the phase as a pbxproj string carries them, the line breaks escaped
  shellScript: [
    'set -e',
    '',
    '# hotcodepush: writes hotcodepush.json into the app and, in a store build, creates the binary',
    'WITH_ENVIRONMENT="$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh"',
    `HOTCODEPUSH_BINARY_CREATE="$REACT_NATIVE_PATH/../${REACT_NATIVE_PACKAGE_NAME}/scripts/binary-create-xcode.sh"`,
    '',
    '/bin/sh -c "$WITH_ENVIRONMENT $HOTCODEPUSH_BINARY_CREATE"',
    '',
  ].join('\\n'),
};

const POD_NAME = 'HotcodepushReactNativeCodePush';

/**
 * React Native: no build output in the project, since each platform's JavaScript is bundled when it is needed — by the
 * native build, whose Xcode phase and Gradle task run binary create on what it bundled, and by the upload, one bundle
 * per platform. The app hands React Native the bundle the SDK serves, one line in `AppDelegate.swift` and one in `MainApplication.kt`.
 */
export const reactNativeFramework: FrameworkModule = {
  packageName: REACT_NATIVE_PACKAGE_NAME,
  versionedPackageNames: ['react-native', REACT_NATIVE_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, REACT_NATIVE_PACKAGE_NAME),
    checkBinaryCreateStep(
      project.directoryPath,
      resolveNativeProjectPaths(project.directoryPath),
      REACT_NATIVE_PACKAGE_NAME,
    ),
    checkBundleWiring(project),
  ],
  collectEmbeddedFiles,
  packageBundles: request =>
    packageReactNativeBundles(request, resolveBundlerArgs),
  readBuildDirectory: () => undefined,
  resolveMainBundlePath,
  resolveNativeProjectPaths,
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
): NativeProjectEdit[] {
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
): NativeProjectEdit[] {
  return [
    resolveGradleEdit(nativeProjectPaths.android, REACT_NATIVE_PACKAGE_NAME),
    ...resolveBundleWiringEdits(nativeProjectPaths),
    resolveCorePodEdit(nativeProjectPaths.ios, projectDirectoryPath),
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
  const wired = await applyNativeProjectEdits(
    xcodeProjectFilePath === undefined
      ? undefined
      : { phase: BINARY_CREATE_PHASE, projectFilePath: xcodeProjectFilePath },
    pendingEdits,
    options,
  );
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
