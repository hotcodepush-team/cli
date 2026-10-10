import type { BundleFile } from '../bundle-files.js';
import type { InteractivityOptions } from '../environment.js';
import type { ConfirmationRequiredError } from '../errors.js';
import type { Framework } from '../framework.js';
import type { StepOutcome } from '../init-steps.js';
import type { PackageJson } from '../package-json.js';
import type { Platform } from '../upload.js';
import { capacitorFramework } from './capacitor.js';
import { cordovaFramework } from './cordova.js';
import { expoFramework } from './expo.js';
import { reactNativeFramework } from './react-native.js';

/**
 * The framework's build output relative to the project root, or why the module names none, which `--path` must then name.
 */
export type BuildDirectory = { missingReason: string } | { path: string };

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
 * What the CLI needs to know about a framework: where its build output and native projects lie, and how its SDK package
 * and build step are wired and checked.
 */
export interface FrameworkModule {
  /**
   * The native glue the platform copies beside the web build, which the binary serves under every bundle: left out of
   * the embedded manifest and of an upload alike, so a release lists what the embedded bundle lists. Without the member
   * nothing is left out.
   */
  nativeGluePaths?: readonly string[];
  packageName: string;
  /**
   * The packages whose installed versions a bug report needs.
   */
  versionedPackageNames: string[];
  /**
   * The SDK package's dependencies whose installed versions a bug report needs, read where the SDK package resolves
   * them, since an isolated install keeps them out of the project's `node_modules`.
   */
  versionedSdkDependencyNames?: string[];
  /**
   * The SDK package and the build step as `doctor` reports them.
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
   * bundled into the packaging directory, so `init` runs no build.
   * Without the member the project's build output is one bundle for every platform.
   */
  packageBundles?: (request: PackagingRequest) => Promise<PackagedBundle[]>;
  /**
   * The framework's own build output, read when the upload runs, what `--path` overrides.
   */
  readBuildDirectory: (projectDirectoryPath: string) => BuildDirectory;
  resolveNativeProjectPaths: (
    projectDirectoryPath: string,
  ) => NativeProjectPaths;
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
   * The native project files wiring the build step would change, relative to the project root.
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
   * Wires the build step, or skips what is wired already; the blocker is thrown where a file would change.
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
