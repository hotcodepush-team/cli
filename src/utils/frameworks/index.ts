import type { PackageJson } from '../binary-create-hook.js';
import type { BinaryIdentity } from '../binary-identity.js';
import type { BundleFile } from '../bundle-files.js';
import type { InteractivityOptions } from '../environment.js';
import type { ConfirmationRequiredError } from '../errors.js';
import type { Framework } from '../framework.js';
import type { StepOutcome } from '../init-steps.js';
import type { Platform } from '../upload.js';
import { capacitorFramework } from './capacitor.js';
import { cordovaFramework } from './cordova.js';
import { expoFramework } from './expo.js';
import { reactNativeFramework } from './react-native.js';

/**
 * One row of `doctor`: a check, its outcome and the step that repairs it.
 */
export interface FrameworkCheck {
  check: string;
  manualStep?: string;
  message: string;
  status: 'failed' | 'ok' | 'skipped';
}

/**
 * What the CLI needs to know about a framework: where its build output and native projects lie, how the store build
 * names itself, and how its SDK package and binary create step are wired and checked.
 */
export interface FrameworkModule {
  /**
   * The step that runs binary create, as `doctor` names it for a missing or stale resource file.
   */
  binaryCreateStep: string;
  packageName: string;
  /**
   * The packages whose installed versions a bug report needs.
   */
  versionedPackageNames: string[];
  /**
   * The SDK package and the binary create step as `doctor` reports them.
   */
  checkWiring: (project: FrameworkProject) => FrameworkCheck[];
  /**
   * The embedded bundle among the files under the build step's `--path`, where a native build's output holds more than
   * the bundle; none when the build bundled nothing. Without the member every file under the path is the bundle.
   */
  collectEmbeddedFiles?: (
    platform: Platform,
    inputDirectoryPath: string,
  ) => Promise<BundleFile[] | undefined>;
  /**
   * The bundles one upload makes, where the framework's packaging runs inside the upload: each platform's JavaScript
   * bundled into the packaging directory. `hotcodepush.json` then names no `dir` and `init` runs no build.
   * Without the member the project's build output is one bundle for every platform.
   */
  packageBundles?: (request: PackagingRequest) => Promise<PackagedBundle[]>;
  readBinaryIdentity: (
    platform: Platform,
    projectDirectoryPath: string,
  ) => BinaryIdentity;
  /**
   * The framework's own build output relative to the project root, what `dir` defaults to.
   */
  readBuildDirectory: (projectDirectoryPath: string) => string | undefined;
  /**
   * The main JavaScript bundle among a bundle's files, which a delta pack carries as a patch; without the member the
   * framework has none.
   */
  resolveMainBundlePath?: MainBundlePathResolver;
  resolveNativeProjectPaths: (
    projectDirectoryPath: string,
  ) => NativeProjectPaths;
  /**
   * Where the platform's native project reads the resource file; none where the native build writes it into the app
   * it builds and names the place with `--out`.
   */
  resolveResourceFilePath: (
    platform: Platform,
    nativeProjectPath: string,
  ) => string | undefined;
  /**
   * What `init` installs and wires in this project, resolved once before the editing steps, asking where it must.
   */
  resolveWiring: (
    project: FrameworkProject,
    options: WiringOptions,
  ) => Promise<FrameworkWiring>;
}

/**
 * The project a framework's steps and checks read: its root and its `package.json`.
 */
export interface FrameworkProject {
  directoryPath: string;
  packageJson: PackageJson | undefined;
}

/**
 * What `init` wires for a framework in one project.
 */
export interface FrameworkWiring {
  isPackageInstalled: boolean;
  /**
   * The native project files wiring the binary create step would change, relative to the project root.
   */
  nativeFilePaths: string[];
  /**
   * The files installing the package and its hook would change, relative to the project root.
   */
  packageFilePaths: string[];
  /**
   * Installs the SDK package visibly and answers the sentence the step prints.
   */
  installPackage: () => string;
  /**
   * Wires the binary create step, or skips what is wired already; the blocker is thrown where a file would change.
   */
  wireBinaryCreateStep: (
    editBlocker: ConfirmationRequiredError | undefined,
  ) => Promise<StepOutcome<undefined>>;
}

/**
 * One bundle of an upload: its files and the platforms it serves.
 */
export interface PackagedBundle {
  directoryPath: string;
  platforms: Platform[];
}

/**
 * What a framework packages for one upload: the project, the platforms `--platform` names, `--path` as typed,
 * and the directory the bundles go into, which the command removes when it ends.
 */
export interface PackagingRequest {
  packagingDirectoryPath: string;
  path: string | undefined;
  platforms: Platform[] | undefined;
  projectDirectoryPath: string;
}

/**
 * The path of a bundle's main JavaScript bundle for a platform, none where its files hold none. A base's and a new
 * bundle's are paired by this role, never by an equal path, since a bundle's file name may carry its content hash.
 */
export type MainBundlePathResolver = (
  files: readonly { path: string }[],
  platform: Platform,
) => string | undefined;

export interface NativeProjectPaths {
  android: string;
  ios: string;
}

export interface WiringOptions extends InteractivityOptions {
  androidPath?: string;
  iosPath?: string;
  xcodeTarget?: string;
}

const FRAMEWORK_MODULES: Record<Framework, FrameworkModule> = {
  'capacitor': capacitorFramework,
  'cordova': cordovaFramework,
  'expo': expoFramework,
  'react-native': reactNativeFramework,
};

export function resolveFrameworkModule(framework: Framework): FrameworkModule {
  return FRAMEWORK_MODULES[framework];
}
