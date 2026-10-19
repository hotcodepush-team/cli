import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { REACT_NATIVE_PACKAGE_NAME } from '../config/consts.js';
import { NativeProjectError } from './errors.js';
import type { NativeProjectEdit } from './native-project-edit.js';
import { resolveRefusedEdit } from './native-project-edit.js';

const APP_DELEGATE_FILE_NAMES = ['AppDelegate.swift', 'AppDelegate.mm'];

const BUNDLE_URL_CALL = 'HotCodePush.bundleURL()';

const BUNDLE_URL_FIX = `Import HotcodepushReactNativeCodePush in the file that overrides bundleURL() and return ${BUNDLE_URL_CALL} from it where it returns the embedded bundle.`;

const BUNDLE_URL_OVERRIDE = 'func bundleURL()';

const CORE_POD_NAME = 'HotCodePushCore';

const CORE_POD_LINE_START = `pod '${CORE_POD_NAME}'`;

const CORE_POD_REPOSITORY_URL =
  'https://github.com/hotcodepush-team/core-ios.git';

const EMBEDDED_BUNDLE_URL_CALL =
  'Bundle.main.url(forResource: "main", withExtension: "jsbundle")';

const OBJECTIVE_C_BUNDLE_URL_CALL = '[HotCodePush bundleURL]';

const REACT_HOST_CLASS = 'com.hotcodepush.reactnative.HotCodePushReactHost';

const REACT_HOST_EDIT_DESCRIPTION =
  'HotCodePushReactHost in MainApplication.kt';

const REACT_HOST_IMPORT = `import ${REACT_HOST_CLASS}.getDefaultReactHost`;

const REACT_NATIVE_REACT_HOST_IMPORT =
  'import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost';

const SWIFT_MODULE_IMPORT = 'import HotcodepushReactNativeCodePush';

/**
 * The file that overrides `bundleURL()` hands React Native the bundle the SDK serves: `SceneDelegate.swift` from React
 * Native 0.88's template on, `AppDelegate.swift` before it. The template's `Bundle.main.url(…)` line becomes
 * `HotCodePush.bundleURL()`, the debug build's Metro line beside it staying as it is. An iOS project without a Swift
 * app delegate gets the manual step; without an iOS project there is no edit.
 */
export function resolveBundleUrlEdit(
  iosProjectPath: string,
): NativeProjectEdit | undefined {
  if (!existsSync(iosProjectPath)) {
    return undefined;
  }
  const appDelegateFilePath = findAppDelegateFilePath(iosProjectPath);
  if (
    appDelegateFilePath === undefined ||
    !appDelegateFilePath.endsWith('.swift')
  ) {
    return resolveRefusedBundleUrlEdit(iosProjectPath, appDelegateFilePath);
  }
  const sceneDelegateFilePath = join(
    dirname(appDelegateFilePath),
    'SceneDelegate.swift',
  );
  const bundleUrlFilePath = [sceneDelegateFilePath, appDelegateFilePath].find(
    hasBundleUrlOverride,
  );
  const filePath = bundleUrlFilePath ?? appDelegateFilePath;
  return {
    description: `${BUNDLE_URL_CALL} in ${basename(filePath)}`,
    filePath,
    isApplied: () => readFileSync(filePath, 'utf8').includes(BUNDLE_URL_CALL),
    apply: () => {
      if (bundleUrlFilePath === undefined) {
        throw new NativeProjectError(
          `Neither ${sceneDelegateFilePath} nor ${appDelegateFilePath} returns the template's main.jsbundle from bundleURL().`,
          BUNDLE_URL_FIX,
        );
      }
      const source = readFileSync(filePath, 'utf8');
      const lastImportLine = source
        .split('\n')
        .findLast(line => line.startsWith('import '));
      if (
        !source.includes(EMBEDDED_BUNDLE_URL_CALL) ||
        lastImportLine === undefined
      ) {
        throw new NativeProjectError(
          `The file ${filePath} does not return the template's main.jsbundle from bundleURL().`,
          `Import HotcodepushReactNativeCodePush in ${filePath} and return ${BUNDLE_URL_CALL} from bundleURL() where it returns the embedded bundle.`,
        );
      }
      writeFileSync(
        filePath,
        source
          .replace(lastImportLine, `${lastImportLine}\n${SWIFT_MODULE_IMPORT}`)
          .replace(EMBEDDED_BUNDLE_URL_CALL, BUNDLE_URL_CALL),
      );
    },
  };
}

/**
 * Until `HotCodePushCore` is published, the Podfile pins the pod at the commit the installed SDK names in its
 * `package.json`, read when the edit is made, since `init` installs the SDK first; the pin falls away at publish.
 */
export function resolveCorePodEdit(
  iosProjectPath: string,
  projectDirectoryPath: string,
): NativeProjectEdit | undefined {
  const filePath = join(iosProjectPath, 'Podfile');
  if (!existsSync(filePath)) {
    return undefined;
  }
  return {
    description: 'the HotCodePushCore pod in the Podfile',
    filePath,
    isApplied: () =>
      readFileSync(filePath, 'utf8').includes(CORE_POD_LINE_START),
    apply: () => {
      const source = readFileSync(filePath, 'utf8');
      const commit = readCorePodCommit(projectDirectoryPath);
      const nativeModulesLine = source
        .split('\n')
        .find(line => line.includes('use_native_modules!'));
      if (commit === undefined || nativeModulesLine === undefined) {
        throw new NativeProjectError(
          commit === undefined
            ? `The package ${REACT_NATIVE_PACKAGE_NAME} in node_modules names no ${CORE_POD_NAME} commit to pin.`
            : `The Podfile ${filePath} has no use_native_modules! line to add the pod after.`,
          `Add "pod '${CORE_POD_NAME}', :git => '${CORE_POD_REPOSITORY_URL}', :commit => '<sha>'" to the app target in ${filePath}, the commit the SDK's README names.`,
        );
      }
      const indentation = /^\s*/.exec(nativeModulesLine)?.[0] ?? '';
      writeFileSync(
        filePath,
        source.replace(
          nativeModulesLine,
          `${nativeModulesLine}\n${indentation}${CORE_POD_LINE_START}, :git => '${CORE_POD_REPOSITORY_URL}', :commit => '${commit}'`,
        ),
      );
    },
  };
}

/**
 * `MainApplication.kt` builds its React host with the SDK's `getDefaultReactHost`, which asks for the served bundle at
 * every start and reload: the import changes, the call and its parameters stay. An Android project without
 * `MainApplication.kt` gets the manual step; without an Android project there is no edit.
 */
export function resolveReactHostEdit(
  androidProjectPath: string,
): NativeProjectEdit | undefined {
  if (!existsSync(androidProjectPath)) {
    return undefined;
  }
  const sourceDirectoryPath = join(
    androidProjectPath,
    'app',
    'src',
    'main',
    'java',
  );
  const filePath = findFilePath(sourceDirectoryPath, 'MainApplication.kt');
  if (filePath === undefined) {
    return resolveRefusedReactHostEdit(
      androidProjectPath,
      findFilePath(sourceDirectoryPath, 'MainApplication.java'),
    );
  }
  return {
    description: REACT_HOST_EDIT_DESCRIPTION,
    filePath,
    isApplied: () => readFileSync(filePath, 'utf8').includes(REACT_HOST_IMPORT),
    apply: () => {
      const source = readFileSync(filePath, 'utf8');
      if (!source.includes(REACT_NATIVE_REACT_HOST_IMPORT)) {
        throw new NativeProjectError(
          `The file ${filePath} does not import the template's DefaultReactHost.getDefaultReactHost.`,
          resolveReactHostFix(filePath),
        );
      }
      writeFileSync(
        filePath,
        source.replace(REACT_NATIVE_REACT_HOST_IMPORT, REACT_HOST_IMPORT),
      );
    },
  };
}

/**
 * The app delegate in the app's own directory under the iOS project, never a pod's or a build's: the Swift one React
 * Native's template has, otherwise the Objective-C one of the templates before 0.77.
 */
function findAppDelegateFilePath(iosProjectPath: string): string | undefined {
  const appDirectoryPaths = readdirSync(iosProjectPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'Pods')
    .map(entry => join(iosProjectPath, entry.name));
  return APP_DELEGATE_FILE_NAMES.flatMap(fileName =>
    appDirectoryPaths.map(directoryPath => join(directoryPath, fileName)),
  ).find(filePath => existsSync(filePath));
}

function findFilePath(
  directoryPath: string,
  fileName: string,
): string | undefined {
  if (!existsSync(directoryPath)) {
    return undefined;
  }
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    const foundPath = entry.isDirectory()
      ? findFilePath(entryPath, fileName)
      : undefined;
    if (foundPath !== undefined) {
      return foundPath;
    }
  }
  return undefined;
}

function hasBundleUrlOverride(filePath: string): boolean {
  return (
    existsSync(filePath) &&
    readFileSync(filePath, 'utf8').includes(BUNDLE_URL_OVERRIDE)
  );
}

function readCorePodCommit(projectDirectoryPath: string): string | undefined {
  const packageJsonPath = join(
    projectDirectoryPath,
    'node_modules',
    REACT_NATIVE_PACKAGE_NAME,
    'package.json',
  );
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  const { hotcodepush } = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    hotcodepush?: { coreIos?: string };
  };
  return hotcodepush?.coreIos;
}

function resolveReactHostFix(location: string): string {
  return `Build the React host in ${location} with ${REACT_HOST_CLASS}.getDefaultReactHost, which takes DefaultReactHost.getDefaultReactHost's parameters.`;
}

/**
 * An iOS project without a Swift app delegate: the manual step names the Objective-C one where there is one, which is
 * wired once it calls `[HotCodePush bundleURL]`.
 */
function resolveRefusedBundleUrlEdit(
  iosProjectPath: string,
  objectiveCFilePath: string | undefined,
): NativeProjectEdit {
  if (objectiveCFilePath === undefined) {
    return resolveRefusedEdit(
      `${BUNDLE_URL_CALL} in AppDelegate.swift`,
      iosProjectPath,
      new NativeProjectError(
        `The iOS project ${iosProjectPath} has no AppDelegate.swift in an app folder.`,
        BUNDLE_URL_FIX,
      ),
    );
  }
  return resolveRefusedEdit(
    `${BUNDLE_URL_CALL} in ${basename(objectiveCFilePath)}`,
    objectiveCFilePath,
    new NativeProjectError(
      `The app delegate ${objectiveCFilePath} is Objective-C, and init edits only the Swift file that overrides bundleURL().`,
      `Import <HotcodepushReactNativeCodePush/HotcodepushReactNativeCodePush-Swift.h> in ${objectiveCFilePath} and return ${OBJECTIVE_C_BUNDLE_URL_CALL} from bundleURL where it returns the embedded bundle.`,
    ),
    OBJECTIVE_C_BUNDLE_URL_CALL,
  );
}

/**
 * An Android project without `MainApplication.kt`: the manual step names the Java one where there is one, which is
 * wired once it names the SDK's `HotCodePushReactHost`, however it imports or calls it.
 */
function resolveRefusedReactHostEdit(
  androidProjectPath: string,
  javaFilePath: string | undefined,
): NativeProjectEdit {
  if (javaFilePath === undefined) {
    return resolveRefusedEdit(
      REACT_HOST_EDIT_DESCRIPTION,
      androidProjectPath,
      new NativeProjectError(
        `The Android project ${androidProjectPath} has no MainApplication.kt in its app's sources.`,
        resolveReactHostFix("the app's Application class"),
      ),
    );
  }
  return resolveRefusedEdit(
    REACT_HOST_EDIT_DESCRIPTION,
    javaFilePath,
    new NativeProjectError(
      `The file ${javaFilePath} is Java, and init edits only the MainApplication.kt of React Native's template.`,
      resolveReactHostFix(javaFilePath),
    ),
    REACT_HOST_CLASS,
  );
}
