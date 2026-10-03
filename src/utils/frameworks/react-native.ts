import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import {
  REACT_NATIVE_PACKAGE_NAME,
  REACT_NATIVE_PACKAGE_SPEC,
} from '../../config/consts.js';
import type { BundleFile } from '../bundle-files.js';
import { collectBundleFiles, computeFileSha256 } from '../bundle-files.js';
import type { CliError, ConfirmationRequiredError } from '../errors.js';
import {
  InvalidParameterError,
  MissingParameterError,
  NativeProjectError,
  XcodeProjectError,
} from '../errors.js';
import type { StepOutcome } from '../init-steps.js';
import {
  resolveInstallCommandLine,
  resolvePackageManager,
  runCommandLineVisibly,
} from '../package-manager.js';
import type { ReactNativeEdit } from '../react-native-project.js';
import {
  resolveBundleUrlEdit,
  resolveGradleEdit,
  resolveProtocolPodEdit,
  resolveReactHostEdit,
} from '../react-native-project.js';
import type { Platform } from '../upload.js';
import {
  addEmbedPhase,
  hasEmbedPhase,
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
  PackagedBundle,
  PackagingRequest,
  WiringOptions,
} from './index.js';

/**
 * The JavaScript of a platform as React Native's own builds name it, in the app and in an uploaded bundle alike.
 */
const BUNDLE_FILE_NAMES: Record<Platform, string> = {
  android: 'index.android.bundle',
  ios: 'main.jsbundle',
};

const EMBED_PHASE_DESCRIPTION = 'the Embed HotCodePush phase in Xcode';

const HERMESC_DIRECTORY_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'osx-bin',
  linux: 'linux64-bin',
  win32: 'win64-bin',
};

const INIT_STEP = 'run hotcodepush init';

const PLATFORMS: Platform[] = ['android', 'ios'];

const POD_NAME = 'HotcodepushReactNativeCodePush';

/**
 * React Native: no build output in the project, since each platform's JavaScript is bundled when it is needed — by the
 * native build, whose Xcode phase and Gradle task run the embed step on what it bundled, and by the upload, one bundle
 * per platform. The app hands React Native the bundle the SDK serves, one line in `AppDelegate.swift` and one in `MainApplication.kt`.
 */
export const reactNativeFramework: FrameworkModule = {
  embedStep: 'build the app natively, which runs the embed step',
  packageName: REACT_NATIVE_PACKAGE_NAME,
  versionedPackageNames: ['react-native', REACT_NATIVE_PACKAGE_NAME],
  checkWiring: project => [
    checkSdkPackage(project, REACT_NATIVE_PACKAGE_NAME),
    checkEmbedStep(project),
    checkBundleWiring(project),
  ],
  collectEmbeddedFiles,
  packageBundles,
  readBinaryIdentity: () => {
    // the Xcode phase and the Gradle task pass the identity in from the build's own variables
    throw new MissingParameterError('--binary-version');
  },
  readBuildDirectory: () => undefined,
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
      manualStep: INIT_STEP,
      message: `not wired in ${[...(isPhaseMissing ? ['the Xcode project'] : []), ...missingFilePaths].join(' and ')}`,
      status: 'failed',
    };
  }
  return { check, message: wiredMessage, status: 'ok' };
}

/**
 * `doctor`'s `hook` row: the Xcode phase and the Gradle line that run the embed step.
 */
function checkEmbedStep({ directoryPath }: FrameworkProject): FrameworkCheck {
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
    'the Xcode phase and the Gradle task run the embed step',
    gradleEdit === undefined ? [] : [gradleEdit],
    directoryPath,
    xcodeProjectFilePath !== undefined && !hasEmbedPhase(xcodeProjectFilePath),
  );
}

/**
 * The embedded bundle among the files under the embed step's `--path`: the staged bundle directory on Android,
 * and in the iOS app the JavaScript with React Native's `assets/` beside it, since the app holds far more.
 * A build that bundled nothing — a debug build Metro serves — embeds nothing.
 */
async function collectEmbeddedFiles(
  platform: Platform,
  inputDirectoryPath: string,
): Promise<BundleFile[] | undefined> {
  const bundleFileName = BUNDLE_FILE_NAMES[platform];
  const bundleFilePath = join(inputDirectoryPath, bundleFileName);
  if (!existsSync(bundleFilePath)) {
    return undefined;
  }
  if (platform === 'android') {
    return collectBundleFiles(inputDirectoryPath);
  }
  const assetsDirectoryPath = join(inputDirectoryPath, 'assets');
  const assetFiles = existsSync(assetsDirectoryPath)
    ? await collectBundleFiles(assetsDirectoryPath)
    : [];
  return [
    ...assetFiles.map(file => ({ ...file, path: `assets/${file.path}` })),
    {
      filePath: bundleFilePath,
      path: bundleFileName,
      sha256: await computeFileSha256(bundleFilePath),
      sizeBytes: statSync(bundleFilePath).size,
    },
  ];
}

function installPackage(projectDirectoryPath: string): string {
  runCommandLineVisibly(
    resolveInstallCommandLine(
      resolvePackageManager(projectDirectoryPath),
      REACT_NATIVE_PACKAGE_SPEC,
    ),
    projectDirectoryPath,
  );
  return `installed ${REACT_NATIVE_PACKAGE_NAME} from ${REACT_NATIVE_PACKAGE_SPEC}`;
}

/**
 * Hermes compiles the JavaScript to bytecode in React Native's own builds, so an uploaded bundle is compiled the same;
 * a project that switched Hermes off in `gradle.properties` or the Podfile ships the JavaScript as it is.
 */
function isHermesEnabled(
  platform: Platform,
  nativeProjectPaths: NativeProjectPaths,
): boolean {
  const [filePath, disabledPattern] =
    platform === 'android'
      ? [
          join(nativeProjectPaths.android, 'gradle.properties'),
          /^\s*hermesEnabled\s*=\s*false\s*$/m,
        ]
      : [
          join(nativeProjectPaths.ios, 'Podfile'),
          /:hermes_enabled\s*=>\s*false/,
        ];
  return (
    !existsSync(filePath) ||
    !disabledPattern.test(readFileSync(filePath, 'utf8'))
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
 * One platform's bundle as React Native's own build makes it: `react-native bundle` for the JavaScript and its assets,
 * then Hermes' compiler over the JavaScript where the app runs Hermes.
 */
function packageBundle(
  projectDirectoryPath: string,
  platform: Platform,
  outputDirectoryPath: string,
): void {
  mkdirSync(outputDirectoryPath, { recursive: true });
  const bundleFilePath = join(outputDirectoryPath, BUNDLE_FILE_NAMES[platform]);
  const hermescFilePath = resolveHermescFilePath(
    projectDirectoryPath,
    platform,
  );
  const javaScriptFilePath =
    hermescFilePath === undefined
      ? bundleFilePath
      : `${outputDirectoryPath}.js`;
  runCommandLineVisibly(
    {
      args: [
        'react-native',
        'bundle',
        '--platform',
        platform,
        '--dev',
        'false',
        '--entry-file',
        resolveEntryFileName(projectDirectoryPath, platform),
        '--bundle-output',
        javaScriptFilePath,
        '--assets-dest',
        outputDirectoryPath,
        '--reset-cache',
        // Hermes compiles the JavaScript itself and needs no minification before it
        ...(hermescFilePath === undefined ? [] : ['--minify', 'false']),
      ],
      command: 'npx',
    },
    projectDirectoryPath,
  );
  if (hermescFilePath !== undefined) {
    runCommandLineVisibly(
      {
        args: [
          '-emit-binary',
          '-max-diagnostic-width=80',
          '-O',
          '-out',
          bundleFilePath,
          javaScriptFilePath,
        ],
        command: hermescFilePath,
      },
      projectDirectoryPath,
    );
  }
}

/**
 * One bundle per platform, since each has its own JavaScript: bundled into the packaging directory, or `--path` as the
 * prepared bundle directory of the one platform `--platform` names.
 */
function packageBundles({
  packagingDirectoryPath,
  path,
  platforms = PLATFORMS,
  projectDirectoryPath,
}: PackagingRequest): Promise<PackagedBundle[]> {
  if (path !== undefined) {
    if (platforms.length !== 1) {
      throw new InvalidParameterError(
        '--path: a prepared React Native bundle serves one platform',
        undefined,
        'name it with --platform ios or --platform android.',
      );
    }
    return Promise.resolve([{ directoryPath: resolve(path), platforms }]);
  }
  return Promise.resolve(
    platforms.map(platform => {
      const directoryPath = join(packagingDirectoryPath, platform);
      packageBundle(projectDirectoryPath, platform, directoryPath);
      return { directoryPath, platforms: [platform] };
    }),
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

/**
 * `index.<platform>.js` where the project has one, `index.js` otherwise, the rule of React Native's own builds.
 */
function resolveEntryFileName(
  projectDirectoryPath: string,
  platform: Platform,
): string {
  const platformEntryFileName = `index.${platform}.js`;
  return existsSync(join(projectDirectoryPath, platformEntryFileName))
    ? platformEntryFileName
    : 'index.js';
}

/**
 * Hermes' compiler as the project's React Native ships it for this machine, none where the app does not run Hermes;
 * an app on Hermes without the compiler cannot be bundled the way its native build bundles it.
 */
function resolveHermescFilePath(
  projectDirectoryPath: string,
  platform: Platform,
): string | undefined {
  if (
    !isHermesEnabled(platform, resolveNativeProjectPaths(projectDirectoryPath))
  ) {
    return undefined;
  }
  const directoryName = HERMESC_DIRECTORY_NAMES[process.platform];
  const fileName = process.platform === 'win32' ? 'hermesc.exe' : 'hermesc';
  const hermescFilePath = [
    ['react-native', 'sdks', 'hermesc'],
    ['hermes-compiler', 'hermesc'],
  ]
    .map(([packageName = '', ...segments]) =>
      resolvePackageDirectoryPath(projectDirectoryPath, packageName, segments),
    )
    .map(directoryPath =>
      directoryPath === undefined || directoryName === undefined
        ? undefined
        : join(directoryPath, directoryName, fileName),
    )
    .find(filePath => filePath !== undefined && existsSync(filePath));
  if (hermescFilePath === undefined) {
    throw new InvalidParameterError(
      "Hermes' compiler was not found in the project's react-native",
      undefined,
      'install the dependencies, or pass --path with a bundle directory prepared for one --platform.',
    );
  }
  return hermescFilePath;
}

function resolveNativeProjectPaths(
  projectDirectoryPath: string,
): NativeProjectPaths {
  return {
    android: join(projectDirectoryPath, 'android'),
    ios: join(projectDirectoryPath, 'ios'),
  };
}

/**
 * A directory inside a package as the project resolves the package, wherever `node_modules` lies.
 */
function resolvePackageDirectoryPath(
  projectDirectoryPath: string,
  packageName: string,
  segments: string[],
): string | undefined {
  try {
    const packageJsonPath = createRequire(
      join(projectDirectoryPath, 'package.json'),
    ).resolve(`${packageName}/package.json`);
    return join(dirname(packageJsonPath), ...segments);
  } catch {
    return undefined;
  }
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
      hasEmbedPhase(xcodeProjectFilePath)
        ? []
        : [xcodeProjectFilePath]),
      ...resolveEdits(directoryPath, nativeProjects)
        .filter(edit => !edit.isApplied())
        .map(({ filePath }) => filePath),
    ].map(filePath => relative(directoryPath, filePath)),
    packageFilePaths: isPackageInstalled ? [] : ['package.json'],
    installPackage: () => installPackage(directoryPath),
    wireEmbedStep: editBlocker =>
      wireEmbedStep(
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
async function wireEmbedStep(
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
    xcodeProjectFilePath === undefined || hasEmbedPhase(xcodeProjectFilePath);
  const pendingEdits = resolveEdits(
    projectDirectoryPath,
    nativeProjects,
  ).filter(edit => !edit.isApplied());
  const arePodsInstalled = isPodInstalled(nativeProjects.ios);
  if (isPhaseWired && pendingEdits.length === 0 && arePodsInstalled) {
    return {
      message: 'the embed step and the bundle wiring already wired',
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
      await addEmbedPhase(xcodeProjectFilePath, options);
      wired.push(EMBED_PHASE_DESCRIPTION);
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
