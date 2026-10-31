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

// A module without a build output gives the reason, and `--path` must then name the directory.
export type BuildDirectory = { missingReason: string } | { path: string };

// A failed check carries a code, so the init skill can branch on why it failed.
export type FrameworkCheck =
  | {
      check: string;
      code: string;
      manualStep?: string;
      message: string;
      status: 'failed';
    }
  | {
      check: string;
      manualStep?: undefined;
      message: string;
      status: 'ok' | 'skipped';
    };

export interface FrameworkModule {
  // Files the platform copies beside the web build. They stay out of the embedded manifest and of an upload alike.
  nativeGluePaths?: readonly string[];
  packageName: string;
  versionedPackageNames: string[];
  versionedSdkDependencyNames?: string[];
  checkWiring: (project: FrameworkProject) => FrameworkCheck[];
  // A native build's output holds more than the bundle. Without this member, every file under `--path` is the bundle.
  collectEmbeddedFiles?: (
    platform: Platform,
    inputDirectoryPath: string,
  ) => Promise<BundleFile[] | undefined>;
  // Bundles the JavaScript per platform during the upload, so `init` runs no build.
  // Without this member, the build output is one bundle for every platform.
  packageBundles?: (request: PackagingRequest) => Promise<PackagedBundle[]>;
  readBuildDirectory: (projectDirectoryPath: string) => BuildDirectory;
  resolveWiring: (
    project: FrameworkProject,
    options: WiringOptions,
  ) => Promise<FrameworkWiring>;
}

export interface FrameworkProject {
  directoryPath: string;
  packageJson: PackageJson | undefined;
}

export interface FrameworkWiring {
  isPackageInstalled: boolean;
  nativeFilePaths: string[];
  packageFilePaths: string[];
  installPackage: () => string;
  // Throws the blocker only where a file would change.
  wireBinaryCreateStep: (
    editBlocker: ConfirmationRequiredError | undefined,
  ) => Promise<StepOutcome<undefined>>;
}

export interface PackagedBundle {
  directoryPath: string;
  platforms: Platform[];
}

// The command removes the packaging directory when it ends.
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
  capacitor: capacitorFramework,
  cordova: cordovaFramework,
  expo: expoFramework,
  react_native: reactNativeFramework,
};

export function resolveFrameworkModule(framework: Framework): FrameworkModule {
  return FRAMEWORK_MODULES[framework];
}
