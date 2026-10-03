import type { BinaryIdentity } from '../binary-identity.js';
import type { BundleFile } from '../bundle-files.js';
import type { PackageJson } from '../embed-hook.js';
import type { InteractivityOptions } from '../environment.js';
import type { ConfirmationRequiredError } from '../errors.js';
import { UnsupportedFrameworkError } from '../errors.js';
import type { Framework } from '../framework.js';
import type { StepOutcome } from '../init-steps.js';
import type { Platform } from '../upload.js';
import { capacitorFramework } from './capacitor.js';
import { cordovaFramework } from './cordova.js';
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
 * names itself, and how its SDK package and embed step are wired and checked.
 */
export interface FrameworkModule {
  /**
   * The step that runs the embed hook, as `doctor` names it for a missing or stale resource file.
   */
  embedStep: string;
  packageName: string;
  /**
   * The packages whose installed versions a bug report needs.
   */
  versionedPackageNames: string[];
  /**
   * The SDK package and the embed step as `doctor` reports them.
   */
  checkWiring: (project: FrameworkProject) => FrameworkCheck[];
  /**
   * The embedded bundle among the files under the embed step's `--path`, where a native build's output holds more than
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
   * The native project files wiring the embed step would change, relative to the project root.
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
   * Wires the embed step, or skips what is wired already; the blocker is thrown where a file would change.
   */
  wireEmbedStep: (
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

export interface NativeProjectPaths {
  android: string;
  ios: string;
}

export interface WiringOptions extends InteractivityOptions {
  androidPath?: string;
  iosPath?: string;
  xcodeTarget?: string;
}

const FRAMEWORK_MODULES: Partial<Record<Framework, FrameworkModule>> = {
  'capacitor': capacitorFramework,
  'cordova': cordovaFramework,
  'react-native': reactNativeFramework,
};

/**
 * The module of a framework the CLI packages; a framework it knows but does not package yet is refused.
 */
export function resolveFrameworkModule(framework: Framework): FrameworkModule {
  const frameworkModule = FRAMEWORK_MODULES[framework];
  if (frameworkModule === undefined) {
    throw new UnsupportedFrameworkError(framework);
  }
  return frameworkModule;
}
