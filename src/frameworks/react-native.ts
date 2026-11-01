import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  REACT_NATIVE_PACKAGE_NAME,
  REACT_NATIVE_PACKAGE_SPEC,
} from '../config/consts.js';
import type { Platform } from '../upload/upload.js';
import type { ConfirmationRequiredError } from '../utils/errors.js';
import { runCommandLineVisibly } from '../utils/package-manager.js';
import type { LocatedNativeProjects } from './binary-create-step.js';
import {
  applyNativeProjectEdits,
  checkBinaryCreateStep,
  checkEdits,
  isBinaryCreatePhaseMissing,
  resolveWiredOutcome,
} from './binary-create-step.js';
import type { NativeProjectEdit } from './native-project-edit.js';
import { resolveGradleEdit } from './native-project-edit.js';
import { locateNativeProjects } from './native-projects.js';
import {
  collectEmbeddedFiles,
  packageReactNativeBundles,
  readBuildDirectory,
  resolveNativeProjectPaths,
} from './react-native-build.js';
import {
  resolveBundleUrlEdit,
  resolveReactHostEdit,
} from './react-native-project.js';
import {
  checkSdkPackage,
  installSdkPackage,
  isSdkPackageDeclared,
} from './sdk-package.js';
import type { BinaryCreatePhase } from './xcode-project.js';
import {
  buildPbxprojShellScript,
  resolveXcodeProjectFilePath,
} from './xcode-project.js';
import type {
  FrameworkCheck,
  FrameworkModule,
  FrameworkProject,
  FrameworkWiring,
  NativeProjectPaths,
  StepOutcome,
  WiringOptions,
} from './index.js';

const ALREADY_WIRED_OUTCOME: StepOutcome<undefined> = {
  message: 'The build step and the bundle wiring are already wired.',
  status: 'skipped',
  value: undefined,
};

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
  detectionPackageName: 'react-native',
  packageName: REACT_NATIVE_PACKAGE_NAME,
  versionedPackageNames: ['react-native', REACT_NATIVE_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, REACT_NATIVE_PACKAGE_NAME),
    checkBinaryCreateStep(project.directoryPath, {
      nativeProjectPaths: resolveNativeProjectPaths(project.directoryPath),
      packageName: REACT_NATIVE_PACKAGE_NAME,
    }),
    checkBundleWiring(project),
  ],
  collectEmbeddedFiles,
  hasConfigFile: () => false,
  packageBundles: request =>
    packageReactNativeBundles(request, resolveBundlerArgs),
  readBuildDirectory,
  resolveWiring,
};

function checkBundleWiring({
  directoryPath,
}: FrameworkProject): FrameworkCheck {
  return checkEdits(
    resolveBundleWiringEdits(resolveNativeProjectPaths(directoryPath)),
    {
      check: 'host',
      projectDirectoryPath: directoryPath,
      wiredMessage: 'React Native runs the bundle the SDK serves.',
    },
  );
}

function installPods(iosProjectPath: string): void {
  runCommandLineVisibly({ args: ['install'], command: 'pod' }, iosProjectPath);
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

function resolveNativeFilePaths({
  nativeProjects,
  xcodeProjectFilePath,
}: LocatedNativeProjects): string[] {
  return [
    ...(isBinaryCreatePhaseMissing(xcodeProjectFilePath)
      ? [xcodeProjectFilePath]
      : []),
    ...resolveEdits(nativeProjects)
      .filter(edit => !edit.isRefused && !edit.isApplied())
      .map(({ filePath }) => filePath),
  ];
}

async function resolveWiring(
  { directoryPath, packageJson }: FrameworkProject,
  options: WiringOptions,
): Promise<FrameworkWiring> {
  const nativeProjects = await locateNativeProjects(options, {
    defaultPaths: resolveNativeProjectPaths(directoryPath),
    missingProjectsStep: 'Pass --ios-path and --android-path.',
    projectDirectoryPath: directoryPath,
  });
  const located = {
    nativeProjects,
    xcodeProjectFilePath: resolveXcodeProjectFilePath(nativeProjects.ios),
  };
  const isPackageInstalled = isSdkPackageDeclared(
    packageJson,
    REACT_NATIVE_PACKAGE_NAME,
  );
  return {
    isPackageInstalled,
    nativeFilePaths: resolveNativeFilePaths(located).map(filePath =>
      relative(directoryPath, filePath),
    ),
    packageFilePaths: isPackageInstalled ? [] : ['package.json'],
    installPackage: () =>
      installSdkPackage(directoryPath, {
        packageName: REACT_NATIVE_PACKAGE_NAME,
        packageSpec: REACT_NATIVE_PACKAGE_SPEC,
      }),
    wireBinaryCreateStep: editBlocker =>
      wireBinaryCreateStep(located, { editBlocker, options }),
  };
}

async function wireBinaryCreateStep(
  { nativeProjects, xcodeProjectFilePath }: LocatedNativeProjects,
  {
    editBlocker,
    options,
  }: {
    editBlocker: ConfirmationRequiredError | undefined;
    options: WiringOptions;
  },
): Promise<StepOutcome<undefined>> {
  if (nativeProjects.missingError !== undefined) {
    throw nativeProjects.missingError;
  }
  const pendingEdits = resolveEdits(nativeProjects).filter(
    edit => !edit.isApplied(),
  );
  const hasEdits =
    isBinaryCreatePhaseMissing(xcodeProjectFilePath) || pendingEdits.length > 0;
  const arePodsInstalled = isPodInstalled(nativeProjects.ios);
  if (!hasEdits && arePodsInstalled) {
    return ALREADY_WIRED_OUTCOME;
  }
  if (editBlocker !== undefined && hasEdits) {
    throw editBlocker;
  }
  const wired = await applyNativeProjectEdits(pendingEdits, {
    options,
    phaseEdit:
      xcodeProjectFilePath === undefined
        ? undefined
        : { phase: BINARY_CREATE_PHASE, projectFilePath: xcodeProjectFilePath },
  });
  if (!arePodsInstalled) {
    installPods(nativeProjects.ios);
    wired.push('the pods through "pod install"');
  }
  return resolveWiredOutcome(wired);
}
