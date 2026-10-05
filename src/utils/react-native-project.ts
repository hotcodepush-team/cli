import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REACT_NATIVE_PACKAGE_NAME } from '../config/consts.js';
import { NativeProjectError } from './errors.js';

/**
 * One line of the React Native project binary create or the bundle wiring lives in: whether it is there, and how it gets there.
 * Every edit is recognised afterwards by the marker it writes, and one the file has no place for is the manual step.
 */
export interface ReactNativeEdit {
  /** What the edit wires, in the words `init` prints. */
  description: string;
  filePath: string;
  isApplied: () => boolean;
  apply: () => void;
}

const BUNDLE_URL_CALL = 'HotCodePush.bundleURL()';

const EMBEDDED_BUNDLE_URL_CALL =
  'Bundle.main.url(forResource: "main", withExtension: "jsbundle")';

const GRADLE_FILE_MARKER = 'hotcodepush.gradle';

const GRADLE_FILE_NAMES = ['build.gradle', 'build.gradle.kts'];

const PROTOCOL_POD_NAME = 'HotCodePushProtocol';

const PROTOCOL_POD_LINE_START = `pod '${PROTOCOL_POD_NAME}'`;

const PROTOCOL_POD_REPOSITORY_URL =
  'https://github.com/hotcodepush-team/protocol-ios.git';

const REACT_HOST_IMPORT =
  'import com.hotcodepush.reactnative.HotCodePushReactHost.getDefaultReactHost';

const REACT_NATIVE_REACT_HOST_IMPORT =
  'import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost';

const RESOLVE_PACKAGE_SCRIPT = `require.resolve('${REACT_NATIVE_PACKAGE_NAME}/package.json')`;

const SWIFT_MODULE_IMPORT = 'import HotcodepushReactNativeCodePush';

/**
 * `AppDelegate.swift` hands React Native the bundle the SDK serves: the template's `Bundle.main.url(…)` line becomes
 * `HotCodePush.bundleURL()`, the debug build's Metro line beside it staying as it is.
 */
export function resolveBundleUrlEdit(
  iosProjectPath: string,
): ReactNativeEdit | undefined {
  const filePath = findAppDelegateFilePath(iosProjectPath);
  if (filePath === undefined) {
    return undefined;
  }
  return {
    description: `${BUNDLE_URL_CALL} in AppDelegate.swift`,
    filePath,
    isApplied: () => readFileSync(filePath, 'utf8').includes(BUNDLE_URL_CALL),
    apply: () => {
      const source = readFileSync(filePath, 'utf8');
      const lastImportLine = source
        .split('\n')
        .findLast(line => line.startsWith('import '));
      if (
        !source.includes(EMBEDDED_BUNDLE_URL_CALL) ||
        lastImportLine === undefined
      ) {
        throw new NativeProjectError(
          `${filePath} does not return the template's main.jsbundle from bundleURL()`,
          `import HotcodepushReactNativeCodePush in ${filePath} and return ${BUNDLE_URL_CALL} from bundleURL() where it returns the embedded bundle.`,
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
 * The app's Gradle file applies the Gradle file the SDK ships, which holds the task that runs binary create: one line, resolved through Node
 * so it finds the package wherever `node_modules` lies, in the syntax of the file it joins.
 */
export function resolveGradleEdit(
  androidProjectPath: string,
): ReactNativeEdit | undefined {
  const filePath = GRADLE_FILE_NAMES.map(fileName =>
    join(androidProjectPath, 'app', fileName),
  ).find(candidatePath => existsSync(candidatePath));
  if (filePath === undefined) {
    return undefined;
  }
  return {
    description: 'the Gradle task that runs binary create',
    filePath,
    isApplied: () =>
      readFileSync(filePath, 'utf8').includes(GRADLE_FILE_MARKER),
    apply: () => {
      const source = readFileSync(filePath, 'utf8');
      const applyLine = filePath.endsWith('.kts')
        ? `apply(from = File(providers.exec { workingDir(rootDir); commandLine("node", "--print", "${RESOLVE_PACKAGE_SCRIPT}") }.standardOutput.asText.get().trim()).resolveSibling("android/${GRADLE_FILE_MARKER}"))`
        : `apply from: new File(["node", "--print", "${RESOLVE_PACKAGE_SCRIPT}"].execute(null, rootDir).text.trim(), "../android/${GRADLE_FILE_MARKER}")`;
      writeFileSync(
        filePath,
        `${source}${source.endsWith('\n') ? '' : '\n'}\n${applyLine}\n`,
      );
    },
  };
}

/**
 * Until `HotCodePushProtocol` is published, the Podfile pins the pod at the commit the installed SDK names in its
 * `package.json`, read when the edit is made, since `init` installs the SDK first; the pin falls away at publish.
 */
export function resolveProtocolPodEdit(
  iosProjectPath: string,
  projectDirectoryPath: string,
): ReactNativeEdit | undefined {
  const filePath = join(iosProjectPath, 'Podfile');
  if (!existsSync(filePath)) {
    return undefined;
  }
  return {
    description: 'the HotCodePushProtocol pod in the Podfile',
    filePath,
    isApplied: () =>
      readFileSync(filePath, 'utf8').includes(PROTOCOL_POD_LINE_START),
    apply: () => {
      const source = readFileSync(filePath, 'utf8');
      const commit = readProtocolPodCommit(projectDirectoryPath);
      const nativeModulesLine = source
        .split('\n')
        .find(line => line.includes('use_native_modules!'));
      if (commit === undefined || nativeModulesLine === undefined) {
        throw new NativeProjectError(
          commit === undefined
            ? `${REACT_NATIVE_PACKAGE_NAME} in node_modules names no ${PROTOCOL_POD_NAME} commit to pin`
            : `${filePath} has no use_native_modules! line to add the pod after`,
          `add "pod '${PROTOCOL_POD_NAME}', :git => '${PROTOCOL_POD_REPOSITORY_URL}', :commit => '<sha>'" to the app target in ${filePath}, the commit the SDK's README names.`,
        );
      }
      const indentation = /^\s*/.exec(nativeModulesLine)?.[0] ?? '';
      writeFileSync(
        filePath,
        source.replace(
          nativeModulesLine,
          `${nativeModulesLine}\n${indentation}${PROTOCOL_POD_LINE_START}, :git => '${PROTOCOL_POD_REPOSITORY_URL}', :commit => '${commit}'`,
        ),
      );
    },
  };
}

/**
 * `MainApplication.kt` builds its React host with the SDK's `getDefaultReactHost`, which asks for the served bundle at
 * every start and reload: the import changes, the call and its parameters stay.
 */
export function resolveReactHostEdit(
  androidProjectPath: string,
): ReactNativeEdit | undefined {
  const filePath = findFilePath(
    join(androidProjectPath, 'app', 'src', 'main', 'java'),
    'MainApplication.kt',
  );
  if (filePath === undefined) {
    return undefined;
  }
  return {
    description: 'HotCodePushReactHost in MainApplication.kt',
    filePath,
    isApplied: () => readFileSync(filePath, 'utf8').includes(REACT_HOST_IMPORT),
    apply: () => {
      const source = readFileSync(filePath, 'utf8');
      if (!source.includes(REACT_NATIVE_REACT_HOST_IMPORT)) {
        throw new NativeProjectError(
          `${filePath} does not import the template's DefaultReactHost.getDefaultReactHost`,
          `build the React host in ${filePath} with com.hotcodepush.reactnative.HotCodePushReactHost.getDefaultReactHost, which takes DefaultReactHost.getDefaultReactHost's parameters.`,
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
 * `AppDelegate.swift` in the app's own directory under the iOS project, never a pod's or a build's.
 */
function findAppDelegateFilePath(iosProjectPath: string): string | undefined {
  if (!existsSync(iosProjectPath)) {
    return undefined;
  }
  return readdirSync(iosProjectPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'Pods')
    .map(entry => join(iosProjectPath, entry.name, 'AppDelegate.swift'))
    .find(filePath => existsSync(filePath));
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

function readProtocolPodCommit(
  projectDirectoryPath: string,
): string | undefined {
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
    hotcodepush?: { protocolIos?: string };
  };
  return hotcodepush?.protocolIos;
}
