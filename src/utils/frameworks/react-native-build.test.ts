import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidParameterError, MissingParameterError } from '../errors.js';
import type * as packageManagerModule from '../package-manager.js';
import { runCommandLineVisibly } from '../package-manager.js';
import {
  collectEmbeddedFiles,
  packageReactNativeBundles,
  readBinaryIdentity,
} from './react-native-build.js';

vi.mock('../package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

const HERMESC_DIRECTORY_NAME = {
  darwin: 'osx-bin',
  linux: 'linux64-bin',
  win32: 'win64-bin',
}[process.platform as 'darwin' | 'linux' | 'win32'];

describe('react-native-build', () => {
  let directoryPath = '';

  function writeFile(filePath: string, content: string): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  function writeHermesc(): string {
    const packagePath = join(directoryPath, 'node_modules', 'react-native');
    writeFile(
      join(packagePath, 'package.json'),
      JSON.stringify({ name: 'react-native', version: '0.82.1' }),
    );
    const hermescFilePath = join(
      packagePath,
      'sdks',
      'hermesc',
      HERMESC_DIRECTORY_NAME,
      process.platform === 'win32' ? 'hermesc.exe' : 'hermesc',
    );
    writeFile(hermescFilePath, '');
    // the project resolves the package through Node, which answers the real path
    return realpathSync(hermescFilePath);
  }

  /**
   * The arguments a framework module contributes to the bundler's command line.
   */
  function resolveBundlerArgs(): string[] {
    return ['bundler'];
  }

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-build-'));
    vi.mocked(runCommandLineVisibly).mockReset();
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  describe('collectEmbeddedFiles', () => {
    it('should take main.jsbundle and assets/ out of the iOS app and leave the rest of it', async () => {
      writeFile(join(directoryPath, 'main.jsbundle'), 'bytecode');
      writeFile(join(directoryPath, 'assets', 'src', 'logo.png'), 'png');
      writeFile(join(directoryPath, 'Info.plist'), '<plist />');
      writeFile(join(directoryPath, 'Demo'), 'executable');

      const files = await collectEmbeddedFiles('ios', directoryPath);

      expect(
        files?.map(({ path, sha256, sizeBytes }) => ({
          path,
          sha256,
          sizeBytes,
        })),
      ).toEqual([
        {
          path: 'assets/src/logo.png',
          sha256: createHash('sha256').update('png').digest('hex'),
          sizeBytes: 3,
        },
        {
          path: 'main.jsbundle',
          sha256: createHash('sha256').update('bytecode').digest('hex'),
          sizeBytes: 8,
        },
      ]);
    });

    it('should take every file of the staged Android bundle directory', async () => {
      writeFile(join(directoryPath, 'index.android.bundle'), 'bytecode');
      writeFile(join(directoryPath, 'drawable-mdpi', 'logo.png'), 'png');

      const files = await collectEmbeddedFiles('android', directoryPath);

      expect(files?.map(({ path }) => path)).toEqual([
        'drawable-mdpi/logo.png',
        'index.android.bundle',
      ]);
    });

    it('should answer nothing when the build bundled no JavaScript', async () => {
      writeFile(join(directoryPath, 'Info.plist'), '<plist />');

      expect(await collectEmbeddedFiles('ios', directoryPath)).toBeUndefined();
    });
  });

  describe('packageReactNativeBundles', () => {
    it("should bundle and compile each platform as its release build does, the source maps beside the bundle's directory", async () => {
      const hermescFilePath = writeHermesc();
      const packagingDirectoryPath = join(directoryPath, 'packaging');
      // Hermes writes the bytecode and, with -output-source-map, its map beside it
      vi.mocked(runCommandLineVisibly).mockImplementation(({ args }) => {
        const outFilePath = args[args.indexOf('-out') + 1];
        if (args.includes('-out') && outFilePath !== undefined) {
          writeFile(outFilePath, 'bytecode');
          if (args.includes('-output-source-map')) {
            writeFile(`${outFilePath}.map`, '{}');
          }
        }
      });

      const packagedBundles = await packageReactNativeBundles(
        {
          packagingDirectoryPath,
          path: undefined,
          platforms: undefined,
          projectDirectoryPath: directoryPath,
        },
        resolveBundlerArgs,
      );

      expect(packagedBundles).toEqual([
        {
          directoryPath: join(packagingDirectoryPath, 'android'),
          platforms: ['android'],
        },
        {
          directoryPath: join(packagingDirectoryPath, 'ios'),
          platforms: ['ios'],
        },
      ]);
      const androidIntermediatePath = join(
        packagingDirectoryPath,
        'android-intermediate',
      );
      const iosIntermediatePath = join(
        packagingDirectoryPath,
        'ios-intermediate',
      );
      expect(vi.mocked(runCommandLineVisibly).mock.calls).toEqual([
        [
          {
            args: [
              'bundler',
              '--platform',
              'android',
              '--dev',
              'false',
              '--bundle-output',
              join(androidIntermediatePath, 'index.android.bundle'),
              '--assets-dest',
              join(packagingDirectoryPath, 'android'),
              '--reset-cache',
              '--sourcemap-output',
              join(
                androidIntermediatePath,
                'index.android.bundle.packager.map',
              ),
              '--minify',
              'false',
            ],
            command: 'npx',
          },
          directoryPath,
        ],
        [
          {
            args: [
              '-emit-binary',
              '-max-diagnostic-width=80',
              '-O',
              '-output-source-map',
              '-out',
              join(androidIntermediatePath, 'index.android.bundle.hbc'),
              join(androidIntermediatePath, 'index.android.bundle'),
            ],
            command: hermescFilePath,
          },
          directoryPath,
        ],
        [
          {
            args: [
              'bundler',
              '--platform',
              'ios',
              '--dev',
              'false',
              '--bundle-output',
              join(iosIntermediatePath, 'main.jsbundle'),
              '--assets-dest',
              join(packagingDirectoryPath, 'ios'),
              '--reset-cache',
              '--minify',
              'false',
            ],
            command: 'npx',
          },
          directoryPath,
        ],
        [
          {
            args: [
              '-emit-binary',
              '-max-diagnostic-width=80',
              '-O',
              '-out',
              join(iosIntermediatePath, 'main.jsbundle.hbc'),
              join(iosIntermediatePath, 'main.jsbundle'),
            ],
            command: hermescFilePath,
          },
          directoryPath,
        ],
      ]);
      expect(readdirSync(join(packagingDirectoryPath, 'android'))).toEqual([
        'index.android.bundle',
      ]);
      expect(
        readFileSync(
          join(packagingDirectoryPath, 'android', 'index.android.bundle'),
          'utf8',
        ),
      ).toBe('bytecode');
      expect(readdirSync(join(packagingDirectoryPath, 'ios'))).toEqual([
        'main.jsbundle',
      ]);
    });

    it("should bundle the JavaScript as it is with Gradle's source map when Android switched Hermes off", async () => {
      writeFile(
        join(directoryPath, 'android', 'gradle.properties'),
        'newArchEnabled=true\nhermesEnabled=false\n',
      );
      const packagingDirectoryPath = join(directoryPath, 'packaging');

      await packageReactNativeBundles(
        {
          packagingDirectoryPath,
          path: undefined,
          platforms: ['android'],
          projectDirectoryPath: directoryPath,
        },
        resolveBundlerArgs,
      );

      expect(vi.mocked(runCommandLineVisibly).mock.calls).toEqual([
        [
          {
            args: [
              'bundler',
              '--platform',
              'android',
              '--dev',
              'false',
              '--bundle-output',
              join(packagingDirectoryPath, 'android', 'index.android.bundle'),
              '--assets-dest',
              join(packagingDirectoryPath, 'android'),
              '--reset-cache',
              '--sourcemap-output',
              join(
                packagingDirectoryPath,
                'android-intermediate',
                'index.android.bundle.map',
              ),
            ],
            command: 'npx',
          },
          directoryPath,
        ],
      ]);
    });

    it("should refuse an app on Hermes whose react-native lacks Hermes' compiler", async () => {
      await expect(
        (async () =>
          packageReactNativeBundles(
            {
              packagingDirectoryPath: join(directoryPath, 'packaging'),
              path: undefined,
              platforms: ['ios'],
              projectDirectoryPath: directoryPath,
            },
            resolveBundlerArgs,
          ))(),
      ).rejects.toThrow(InvalidParameterError);
      expect(runCommandLineVisibly).not.toHaveBeenCalled();
    });

    it('should take --path as the prepared bundle of the one platform named, and bundle nothing', async () => {
      writeFile(join(directoryPath, 'export', 'main.jsbundle'), 'bytecode');

      expect(
        await packageReactNativeBundles(
          {
            packagingDirectoryPath: join(directoryPath, 'packaging'),
            path: join(directoryPath, 'export'),
            platforms: ['ios'],
            projectDirectoryPath: directoryPath,
          },
          resolveBundlerArgs,
        ),
      ).toEqual([
        { directoryPath: join(directoryPath, 'export'), platforms: ['ios'] },
      ]);
      expect(runCommandLineVisibly).not.toHaveBeenCalled();
    });

    it('should refuse --path when the directory holds no bundle under the name the app loads', async () => {
      writeFile(
        join(directoryPath, 'export', 'index-0123abcd.hbc'),
        'bytecode',
      );

      await expect(
        (async () =>
          packageReactNativeBundles(
            {
              packagingDirectoryPath: join(directoryPath, 'packaging'),
              path: join(directoryPath, 'export'),
              platforms: ['android'],
              projectDirectoryPath: directoryPath,
            },
            resolveBundlerArgs,
          ))(),
      ).rejects.toThrow(
        new InvalidParameterError(
          `--path: ${join(directoryPath, 'export')} holds no index.android.bundle, the JavaScript the android app loads`,
          undefined,
          "pass the android bundle's directory, with index.android.bundle in it, or leave out --path to bundle the project.",
        ),
      );
    });

    it('should refuse --path without the one platform it serves', async () => {
      await expect(
        (async () =>
          packageReactNativeBundles(
            {
              packagingDirectoryPath: join(directoryPath, 'packaging'),
              path: join(directoryPath, 'export'),
              platforms: undefined,
              projectDirectoryPath: directoryPath,
            },
            resolveBundlerArgs,
          ))(),
      ).rejects.toThrow(
        new InvalidParameterError(
          '--path: a prepared bundle serves one platform',
          undefined,
          'name it with --platform ios or --platform android.',
        ),
      );
    });
  });

  describe('readBinaryIdentity', () => {
    it('should name the flag the native build passes the identity in with', () => {
      expect(() => readBinaryIdentity()).toThrow(
        new MissingParameterError('--binary-version'),
      );
    });
  });
});
