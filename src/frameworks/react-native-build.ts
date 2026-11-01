import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { BundleFile } from '../upload/bundle-files.js';
import {
  collectBundleFiles,
  computeFileSha256,
} from '../upload/bundle-files.js';
import type { Platform } from '../upload/upload.js';
import { PLATFORMS } from '../upload/upload.js';
import { InvalidParameterError } from '../utils/errors.js';
import { runCommandLineVisibly } from '../utils/package-manager.js';
import type {
  BuildDirectory,
  NativeProjectPaths,
  PackagedBundle,
  PackagingRequest,
} from './index.js';

export type BundlerArgsResolver = (
  projectDirectoryPath: string,
  platform: Platform,
) => string[];

// The names React Native's own builds give the JavaScript, in the app and in an uploaded bundle alike.
interface BundlePaths {
  bundleFilePath: string;
  javaScriptFilePath: string;
  outputDirectoryPath: string;
  sourceMapFilePath: string | undefined;
}

const BUNDLE_FILE_NAMES: Record<Platform, string> = {
  android: 'index.android.bundle',
  ios: 'main.jsbundle',
};

// React Native's release build defaults: the Gradle plugin's `hermesFlags`, and react-native-xcode.sh without `SOURCEMAP_FILE`.
// On Android the source map takes the debug information out of the bytecode, on iOS it stays inline.
const HERMES_FLAGS: Record<Platform, string[]> = {
  android: ['-O', '-output-source-map'],
  ios: ['-O'],
};

const HERMESC_DIRECTORY_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'osx-bin',
  linux: 'linux64-bin',
  win32: 'win64-bin',
};

// The iOS app holds far more than the bundle, so only the JavaScript and `assets/` are taken.
// A debug build that Metro serves has no bundle and gives the build step nothing to hash.
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
    return Promise.resolve([readPreparedBundle(path, platforms)]);
  }
  return Promise.resolve(
    platforms.map(platform => {
      const directoryPath = join(packagingDirectoryPath, platform);
      packageBundle(projectDirectoryPath, {
        bundlerArgs: resolveBundlerArgs(projectDirectoryPath, platform),
        outputDirectoryPath: directoryPath,
        platform,
      });
      return { directoryPath, platforms: [platform] };
    }),
  );
}

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

function compileHermesBytecode(
  projectDirectoryPath: string,
  {
    hermescFilePath,
    paths: { bundleFilePath, javaScriptFilePath },
    platform,
  }: { hermescFilePath: string; paths: BundlePaths; platform: Platform },
): void {
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

// Mirrors the release build. Intermediate files go beside the bundle's directory, never into it.
function packageBundle(
  projectDirectoryPath: string,
  {
    bundlerArgs,
    outputDirectoryPath,
    platform,
  }: { bundlerArgs: string[]; outputDirectoryPath: string; platform: Platform },
): void {
  const intermediateDirectoryPath = `${outputDirectoryPath}-intermediate`;
  mkdirSync(outputDirectoryPath, { recursive: true });
  mkdirSync(intermediateDirectoryPath, { recursive: true });
  const hermescFilePath = resolveHermescFilePath(
    projectDirectoryPath,
    platform,
  );
  const paths = resolveBundlePaths({
    hermescFilePath,
    intermediateDirectoryPath,
    outputDirectoryPath,
    platform,
  });
  runBundler(projectDirectoryPath, {
    bundlerArgs,
    isHermesCompiled: hermescFilePath !== undefined,
    paths,
    platform,
  });
  if (hermescFilePath !== undefined) {
    compileHermesBytecode(projectDirectoryPath, {
      hermescFilePath,
      paths,
      platform,
    });
  }
}

// A prepared bundle serves the one platform whose JavaScript it holds.
function readPreparedBundle(
  path: string,
  platforms: Platform[],
): PackagedBundle {
  const [platform] = platforms;
  if (platform === undefined || platforms.length > 1) {
    throw new InvalidParameterError(
      'A prepared bundle from --path serves one platform.',
      { fix: 'Name it with --platform ios or --platform android.' },
    );
  }
  const directoryPath = resolve(path);
  const bundleFileName = BUNDLE_FILE_NAMES[platform];
  if (!existsSync(join(directoryPath, bundleFileName))) {
    throw new InvalidParameterError(
      `The directory ${directoryPath} from --path holds no ${bundleFileName}, the JavaScript the ${platform} app loads.`,
      {
        fix: `Pass the ${platform} bundle's directory, with ${bundleFileName} in it, or leave out --path to bundle the project.`,
      },
    );
  }
  return { directoryPath, platforms };
}

// Hermes compiles the JavaScript in the intermediate directory into the bundle file.
function resolveBundlePaths({
  hermescFilePath,
  intermediateDirectoryPath,
  outputDirectoryPath,
  platform,
}: {
  hermescFilePath: string | undefined;
  intermediateDirectoryPath: string;
  outputDirectoryPath: string;
  platform: Platform;
}): BundlePaths {
  const bundleFileName = BUNDLE_FILE_NAMES[platform];
  const bundleFilePath = join(outputDirectoryPath, bundleFileName);
  const sourceMapFileName = resolvePackagerSourceMapFileName(
    platform,
    hermescFilePath !== undefined,
  );
  return {
    bundleFilePath,
    javaScriptFilePath:
      hermescFilePath === undefined
        ? bundleFilePath
        : join(intermediateDirectoryPath, bundleFileName),
    outputDirectoryPath,
    sourceMapFilePath:
      sourceMapFileName === undefined
        ? undefined
        : join(intermediateDirectoryPath, sourceMapFileName),
  };
}

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
      resolvePackageDirectoryPath(projectDirectoryPath, {
        packageName,
        segments,
      }),
    )
    .map(directoryPath =>
      directoryPath === undefined || directoryName === undefined
        ? undefined
        : join(directoryPath, directoryName, fileName),
    )
    .find(filePath => filePath !== undefined && existsSync(filePath));
  if (hermescFilePath === undefined) {
    throw new InvalidParameterError(
      "Hermes' compiler was not found in the project's react-native.",
      {
        fix: 'Install the dependencies, or pass --path with a bundle directory prepared for one --platform.',
      },
    );
  }
  return hermescFilePath;
}

function resolvePackageDirectoryPath(
  projectDirectoryPath: string,
  { packageName, segments }: { packageName: string; segments: string[] },
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

// The JavaScript ends with a comment naming its source map, so the name must match React Native's release build.
// Gradle always writes one, and Xcode none by default.
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

function runBundler(
  projectDirectoryPath: string,
  {
    bundlerArgs,
    isHermesCompiled,
    paths: { javaScriptFilePath, outputDirectoryPath, sourceMapFilePath },
    platform,
  }: {
    bundlerArgs: string[];
    isHermesCompiled: boolean;
    paths: BundlePaths;
    platform: Platform;
  },
): void {
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
        ...(sourceMapFilePath === undefined
          ? []
          : ['--sourcemap-output', sourceMapFilePath]),
        // Hermes compiles the JavaScript itself and needs no minification before it.
        ...(isHermesCompiled ? ['--minify', 'false'] : []),
      ],
      command: 'npx',
    },
    projectDirectoryPath,
  );
}
