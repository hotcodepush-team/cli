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
import { InvalidParameterError } from '../utils/errors.js';
import type * as packageManagerModule from '../utils/package-manager.js';
import { runCommandLineVisibly } from '../utils/package-manager.js';
import {
  collectEmbeddedFiles,
  packageReactNativeBundle,
} from './react-native-build.js';

vi.mock('../utils/package-manager.js', async importOriginal => ({
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

  function writeFile(filePath: string, { content }: { content: string }): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  function writeHermesc(): string {
    const packagePath = join(directoryPath, 'node_modules', 'react-native');
    writeFile(join(packagePath, 'package.json'), {
      content: JSON.stringify({ name: 'react-native', version: '0.82.1' }),
    });
    const hermescFilePath = join(
      packagePath,
      'sdks',
      'hermesc',
      HERMESC_DIRECTORY_NAME,
      process.platform === 'win32' ? 'hermesc.exe' : 'hermesc',
    );
    writeFile(hermescFilePath, { content: '' });
    // Node resolves the package to its real path.
    return realpathSync(hermescFilePath);
  }

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
      writeFile(join(directoryPath, 'main.jsbundle'), { content: 'bytecode' });
      writeFile(join(directoryPath, 'assets', 'src', 'logo.png'), {
        content: 'png',
      });
      writeFile(join(directoryPath, 'Info.plist'), { content: '<plist />' });
      writeFile(join(directoryPath, 'Demo'), { content: 'executable' });

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
      writeFile(join(directoryPath, 'index.android.bundle'), {
        content: 'bytecode',
      });
      writeFile(join(directoryPath, 'drawable-mdpi', 'logo.png'), {
        content: 'png',
      });

      const files = await collectEmbeddedFiles('android', directoryPath);

      expect(files?.map(({ path }) => path)).toEqual([
        'drawable-mdpi/logo.png',
        'index.android.bundle',
      ]);
    });

    it('should answer nothing when the build bundled no JavaScript', async () => {
      writeFile(join(directoryPath, 'Info.plist'), { content: '<plist />' });

      expect(await collectEmbeddedFiles('ios', directoryPath)).toBeUndefined();
    });
  });

  describe('packageReactNativeBundle', () => {
    it("should bundle and compile each platform as its release build does, the source maps beside the bundle's directory", async () => {
      const hermescFilePath = writeHermesc();
      const packagingDirectoryPath = join(directoryPath, 'packaging');
      // With -output-source-map, Hermes writes the map beside the bytecode.
      vi.mocked(runCommandLineVisibly).mockImplementation(({ args }) => {
        const outFilePath = args[args.indexOf('-out') + 1];
        if (args.includes('-out') && outFilePath !== undefined) {
          writeFile(outFilePath, { content: 'bytecode' });
          if (args.includes('-output-source-map')) {
            writeFile(`${outFilePath}.map`, { content: '{}' });
          }
        }
      });

      const packagedDirectoryPaths = [
        await packageReactNativeBundle(
          {
            packagingDirectoryPath,
            path: undefined,
            platform: 'android',
            projectDirectoryPath: directoryPath,
          },
          resolveBundlerArgs,
        ),
        await packageReactNativeBundle(
          {
            packagingDirectoryPath,
            path: undefined,
            platform: 'ios',
            projectDirectoryPath: directoryPath,
          },
          resolveBundlerArgs,
        ),
      ];

      expect(packagedDirectoryPaths).toEqual([
        join(packagingDirectoryPath, 'android'),
        join(packagingDirectoryPath, 'ios'),
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
      writeFile(join(directoryPath, 'android', 'gradle.properties'), {
        content: 'newArchEnabled=true\nhermesEnabled=false\n',
      });
      const packagingDirectoryPath = join(directoryPath, 'packaging');

      await packageReactNativeBundle(
        {
          packagingDirectoryPath,
          path: undefined,
          platform: 'android',
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
          packageReactNativeBundle(
            {
              packagingDirectoryPath: join(directoryPath, 'packaging'),
              path: undefined,
              platform: 'ios',
              projectDirectoryPath: directoryPath,
            },
            resolveBundlerArgs,
          ))(),
      ).rejects.toThrow(InvalidParameterError);
      expect(runCommandLineVisibly).not.toHaveBeenCalled();
    });

    it('should take --path as the prepared bundle of the one platform named, and bundle nothing', async () => {
      writeFile(join(directoryPath, 'export', 'main.jsbundle'), {
        content: 'bytecode',
      });

      expect(
        await packageReactNativeBundle(
          {
            packagingDirectoryPath: join(directoryPath, 'packaging'),
            path: join(directoryPath, 'export'),
            platform: 'ios',
            projectDirectoryPath: directoryPath,
          },
          resolveBundlerArgs,
        ),
      ).toBe(join(directoryPath, 'export'));
      expect(runCommandLineVisibly).not.toHaveBeenCalled();
    });

    it('should refuse --path when the directory holds no bundle under the name the app loads', async () => {
      writeFile(join(directoryPath, 'export', 'index-0123abcd.hbc'), {
        content: 'bytecode',
      });

      await expect(
        (async () =>
          packageReactNativeBundle(
            {
              packagingDirectoryPath: join(directoryPath, 'packaging'),
              path: join(directoryPath, 'export'),
              platform: 'android',
              projectDirectoryPath: directoryPath,
            },
            resolveBundlerArgs,
          ))(),
      ).rejects.toThrow(
        new InvalidParameterError(
          `The directory ${join(directoryPath, 'export')} from --path holds no index.android.bundle, the JavaScript the android app loads.`,
          {
            fix: "Pass the android bundle's directory, with index.android.bundle in it, or leave out --path to bundle the project.",
          },
        ),
      );
    });
  });
});
