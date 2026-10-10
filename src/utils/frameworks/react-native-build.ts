import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { BundleFile } from '../bundle-files.js';
import { collectBundleFiles, computeFileSha256 } from '../bundle-files.js';
import { InvalidParameterError } from '../errors.js';
import { runCommandLineVisibly } from '../package-manager.js';
import type { Platform } from '../upload.js';
import type {
  BuildDirectory,
  NativeProjectPaths,
  PackagedBundle,
  PackagingRequest,
} from './index.js';

/**
 * The bundler's command and the arguments of its own for one platform, before the options every React Native bundler takes.
 */
export type BundlerArgsResolver = (
  projectDirectoryPath: string,
  platform: Platform,
) => string[];

/**
 * The JavaScript of a platform as React Native's own builds name it, in the app and in an uploaded bundle alike.
 */
const BUNDLE_FILE_NAMES: Record<Platform, string> = {
  android: 'index.android.bundle',
  ios: 'main.jsbundle',
};

/**
 * Hermes' flags in React Native's release build by default: the Gradle plugin's `hermesFlags`, whose source map takes the
 * debug information out of the bytecode, and react-native-xcode.sh's without `SOURCEMAP_FILE`, which keeps it inline.
 */
const HERMES_FLAGS: Record<Platform, string[]> = {
  android: ['-O', '-output-source-map'],
  ios: ['-O'],
};

const HERMESC_DIRECTORY_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'osx-bin',
  linux: 'linux64-bin',
  win32: 'win64-bin',
};

const PLATFORMS: Platform[] = ['android', 'ios'];

/**
 * The embedded bundle among the files under the build step's `--embedded-bundle-path`: the staged bundle directory on Android,
 * and in the iOS app the JavaScript with React Native's `assets/` beside it, since the app holds far more.
 * A build that bundled nothing — a debug build Metro serves — gives the build step nothing to hash.
 */
export async function collectEmbeddedFiles(
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

/**
 * One bundle per platform, since each has its own JavaScript: bundled into the packaging directory, or `--path` as the
 * prepared bundle directory of the one platform `--platform` names, which holds the JavaScript under the name the app loads.
 */
export function packageReactNativeBundles(
  {
    packagingDirectoryPath,
    path,
    platforms = PLATFORMS,
    projectDirectoryPath,
  }: PackagingRequest,
  resolveBundlerArgs: BundlerArgsResolver,
): Promise<PackagedBundle[]> {
  if (path !== undefined) {
    const [platform] = platforms;
    if (platform === undefined || platforms.length > 1) {
      throw new InvalidParameterError(
        '--path: a prepared bundle serves one platform',
        undefined,
        'name it with --platform ios or --platform android.',
      );
    }
    const directoryPath = resolve(path);
    const bundleFileName = BUNDLE_FILE_NAMES[platform];
    if (!existsSync(join(directoryPath, bundleFileName))) {
      throw new InvalidParameterError(
        `--path: ${directoryPath} holds no ${bundleFileName}, the JavaScript the ${platform} app loads`,
        undefined,
        `pass the ${platform} bundle's directory, with ${bundleFileName} in it, or leave out --path to bundle the project.`,
      );
    }
    return Promise.resolve([{ directoryPath, platforms }]);
  }
  return Promise.resolve(
    platforms.map(platform => {
      const directoryPath = join(packagingDirectoryPath, platform);
      packageBundle(
        projectDirectoryPath,
        platform,
        directoryPath,
        resolveBundlerArgs(projectDirectoryPath, platform),
      );
      return { directoryPath, platforms: [platform] };
    }),
  );
}

/**
 * No build output in the project: an upload bundles the JavaScript itself, and the build step is named the app's bundle.
 */
export function readBuildDirectory(): BuildDirectory {
  return {
    missingReason: 'the embedded bundle lies in the app the native build makes',
  };
}

export function resolveNativeProjectPaths(
  projectDirectoryPath: string,
): NativeProjectPaths {
  return {
    android: join(projectDirectoryPath, 'android'),
    ios: join(projectDirectoryPath, 'ios'),
  };
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
 * One platform's bundle as the platform's release build makes it: the bundler for the JavaScript and its assets, then
 * Hermes' compiler over the JavaScript where the app runs Hermes. The JavaScript, the source maps and the bytecode are
 * written beside the bundle's directory, never into it, and the bytecode then moves in as the bundle.
 */
function packageBundle(
  projectDirectoryPath: string,
  platform: Platform,
  outputDirectoryPath: string,
  bundlerArgs: string[],
): void {
  const intermediateDirectoryPath = `${outputDirectoryPath}-intermediate`;
  mkdirSync(outputDirectoryPath, { recursive: true });
  mkdirSync(intermediateDirectoryPath, { recursive: true });
  const bundleFileName = BUNDLE_FILE_NAMES[platform];
  const bundleFilePath = join(outputDirectoryPath, bundleFileName);
  const hermescFilePath = resolveHermescFilePath(
    projectDirectoryPath,
    platform,
  );
  const javaScriptFilePath =
    hermescFilePath === undefined
      ? bundleFilePath
      : join(intermediateDirectoryPath, bundleFileName);
  const sourceMapFileName = resolvePackagerSourceMapFileName(
    platform,
    hermescFilePath !== undefined,
  );
  runCommandLineVisibly(
    {
      args: [
        ...bundlerArgs,
        '--platform',
        platform,
        '--dev',
        'false',
        '--bundle-output',
        javaScriptFilePath,
        '--assets-dest',
        outputDirectoryPath,
        '--reset-cache',
        ...(sourceMapFileName === undefined
          ? []
          : [
              '--sourcemap-output',
              join(intermediateDirectoryPath, sourceMapFileName),
            ]),
        // Hermes compiles the JavaScript itself and needs no minification before it
        ...(hermescFilePath === undefined ? [] : ['--minify', 'false']),
      ],
      command: 'npx',
    },
    projectDirectoryPath,
  );
  if (hermescFilePath !== undefined) {
    const bytecodeFilePath = `${javaScriptFilePath}.hbc`;
    runCommandLineVisibly(
      {
        args: [
          '-emit-binary',
          '-max-diagnostic-width=80',
          ...HERMES_FLAGS[platform],
          '-out',
          bytecodeFilePath,
          javaScriptFilePath,
        ],
        command: hermescFilePath,
      },
      projectDirectoryPath,
    );
    renameSync(bytecodeFilePath, bundleFilePath);
  }
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

/**
 * The source map React Native's release build has the bundler write, by name, since the JavaScript ends with a comment
 * naming it: Gradle always writes one, the packager's beside Hermes and the bundle's own without it; Xcode none by default.
 */
function resolvePackagerSourceMapFileName(
  platform: Platform,
  isHermesEnabledForPlatform: boolean,
): string | undefined {
  if (platform === 'ios') {
    return undefined;
  }
  const bundleFileName = BUNDLE_FILE_NAMES[platform];
  return isHermesEnabledForPlatform
    ? `${bundleFileName}.packager.map`
    : `${bundleFileName}.map`;
}
