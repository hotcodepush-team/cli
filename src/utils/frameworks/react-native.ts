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
  resolveReactHostEdit,
} from '../react-native-project.js';
import type { Platform } from '../upload.js';
import type { BinaryCreatePhase } from '../xcode-project.js';
import {
  buildPbxprojShellScript,
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
  readBuildDirectory,
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

// React Native's `with-environment.sh` finds Node for the script.
const BINARY_CREATE_PHASE: BinaryCreatePhase = {
  anchorPhaseName: 'Bundle React Native code and images',
  fix: `Add a Run Script phase after "Bundle React Native code and images" that runs node_modules/${REACT_NATIVE_PACKAGE_NAME}/scripts/binary-create-xcode.sh through React Native's with-environment.sh.`,
  shellScript: buildPbxprojShellScript([
    'set -e',
    '',
    '# hotcodepush: writes hotcodepush.json into the app and, in a store build, creates the binary',
    'WITH_ENVIRONMENT="$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh"',
    `HOTCODEPUSH_BINARY_CREATE="$REACT_NATIVE_PATH/../${REACT_NATIVE_PACKAGE_NAME}/scripts/binary-create-xcode.sh"`,
    '',
    '/bin/sh -c "$WITH_ENVIRONMENT $HOTCODEPUSH_BINARY_CREATE"',
    '',
  ]),
};

const POD_NAME = 'HotcodepushReactNativeCodePush';

// The project has no build output: the native build and the upload each bundle the JavaScript when needed.
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
  readBuildDirectory,
  resolveWiring,
};

function checkBundleWiring({
  directoryPath,
}: FrameworkProject): FrameworkCheck {
  return checkEdits(
    'host',
    'React Native runs the bundle the SDK serves.',
    resolveBundleWiringEdits(resolveNativeProjectPaths(directoryPath)),
    directoryPath,
  );
}

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

function resolveBundleWiringEdits(
  nativeProjectPaths: NativeProjectPaths,
): NativeProjectEdit[] {
  return [
    resolveBundleUrlEdit(nativeProjectPaths.ios),
    resolveReactHostEdit(nativeProjectPaths.android),
  ].filter(edit => edit !== undefined);
}

// React Native's own builds prefer `index.<platform>.js` over `index.js`.
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

function resolveEdits(
  nativeProjectPaths: NativeProjectPaths,
): NativeProjectEdit[] {
  return [
    resolveGradleEdit(nativeProjectPaths.android, REACT_NATIVE_PACKAGE_NAME),
    ...resolveBundleWiringEdits(nativeProjectPaths),
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
    'Pass --ios-path and --android-path.',
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
      ...resolveEdits(nativeProjects)
        .filter(edit => !edit.isRefused && !edit.isApplied())
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
        nativeProjects,
        xcodeProjectFilePath,
        editBlocker,
        options,
      ),
  };
}

async function wireBinaryCreateStep(
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
  const pendingEdits = resolveEdits(nativeProjects).filter(
    edit => !edit.isApplied(),
  );
  const arePodsInstalled = isPodInstalled(nativeProjects.ios);
  if (isPhaseWired && pendingEdits.length === 0 && arePodsInstalled) {
    return {
      message: 'The build step and the bundle wiring are already wired.',
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
    wired.push('the pods through "pod install"');
  }
  return {
    message: `Wired ${wired.join(', ')}.`,
    status: 'done',
    value: undefined,
  };
}
