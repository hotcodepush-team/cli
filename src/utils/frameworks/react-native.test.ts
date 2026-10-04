import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_DELEGATE_FILE_PATH,
  APP_GRADLE_FILE_PATH,
  MAIN_APPLICATION_FILE_PATH,
  PODFILE_PATH,
  XCODE_PROJECT_FILE_PATH,
  readProjectFile,
  writeInstalledSdk,
  writeReactNativeProject,
} from '../../../test/react-native-project.js';
import {
  ConfirmationRequiredError,
  InvalidParameterError,
  MissingParameterError,
  NativeProjectError,
} from '../errors.js';
import type * as packageManagerModule from '../package-manager.js';
import { runCommandLineVisibly } from '../package-manager.js';
import { reactNativeFramework } from './react-native.js';

vi.mock('../package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

const HERMESC_DIRECTORY_NAME = {
  darwin: 'osx-bin',
  linux: 'linux64-bin',
  win32: 'win64-bin',
}[process.platform as 'darwin' | 'linux' | 'win32'];

describe('reactNativeFramework', () => {
  const directoryPaths: string[] = [];

  function writeProject(
    options: Parameters<typeof writeReactNativeProject>[0] = {},
  ): string {
    const directoryPath = writeReactNativeProject(options);
    directoryPaths.push(directoryPath);
    return directoryPath;
  }

  function writeFile(filePath: string, content: string): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  function writeHermesc(directoryPath: string): string {
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

  function readProject(directoryPath: string) {
    return {
      directoryPath,
      packageJson: JSON.parse(readProjectFile(directoryPath, 'package.json')),
    };
  }

  beforeEach(() => {
    vi.mocked(runCommandLineVisibly).mockReset();
  });

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  describe('collectEmbeddedFiles', () => {
    let inputDirectoryPath = '';

    beforeEach(() => {
      inputDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-app-'));
      directoryPaths.push(inputDirectoryPath);
    });

    it('should take main.jsbundle and assets/ out of the iOS app and leave the rest of it', async () => {
      writeFile(join(inputDirectoryPath, 'main.jsbundle'), 'bytecode');
      writeFile(join(inputDirectoryPath, 'assets', 'src', 'logo.png'), 'png');
      writeFile(join(inputDirectoryPath, 'Info.plist'), '<plist />');
      writeFile(join(inputDirectoryPath, 'Demo'), 'executable');

      const files = await reactNativeFramework.collectEmbeddedFiles?.(
        'ios',
        inputDirectoryPath,
      );

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
      writeFile(join(inputDirectoryPath, 'index.android.bundle'), 'bytecode');
      writeFile(join(inputDirectoryPath, 'drawable-mdpi', 'logo.png'), 'png');

      const files = await reactNativeFramework.collectEmbeddedFiles?.(
        'android',
        inputDirectoryPath,
      );

      expect(files?.map(({ path }) => path)).toEqual([
        'drawable-mdpi/logo.png',
        'index.android.bundle',
      ]);
    });

    it('should answer nothing when the build bundled no JavaScript', async () => {
      writeFile(join(inputDirectoryPath, 'Info.plist'), '<plist />');

      expect(
        await reactNativeFramework.collectEmbeddedFiles?.(
          'ios',
          inputDirectoryPath,
        ),
      ).toBeUndefined();
    });
  });

  describe('packageBundles', () => {
    it('should bundle each platform with react-native bundle and compile it with Hermes, one bundle per platform', async () => {
      const directoryPath = writeProject();
      const hermescFilePath = writeHermesc(directoryPath);
      const packagingDirectoryPath = join(directoryPath, 'packaging');

      const packagedBundles = await reactNativeFramework.packageBundles?.({
        packagingDirectoryPath,
        path: undefined,
        platforms: undefined,
        projectDirectoryPath: directoryPath,
      });

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
      expect(vi.mocked(runCommandLineVisibly).mock.calls).toEqual([
        [
          {
            args: [
              'react-native',
              'bundle',
              '--platform',
              'android',
              '--dev',
              'false',
              '--entry-file',
              'index.js',
              '--bundle-output',
              join(packagingDirectoryPath, 'android.js'),
              '--assets-dest',
              join(packagingDirectoryPath, 'android'),
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
              join(packagingDirectoryPath, 'android', 'index.android.bundle'),
              join(packagingDirectoryPath, 'android.js'),
            ],
            command: hermescFilePath,
          },
          directoryPath,
        ],
        [
          expect.objectContaining({
            args: expect.arrayContaining([
              '--platform',
              'ios',
              '--bundle-output',
              join(packagingDirectoryPath, 'ios.js'),
            ]),
          }),
          directoryPath,
        ],
        [
          expect.objectContaining({
            args: expect.arrayContaining([
              join(packagingDirectoryPath, 'ios', 'main.jsbundle'),
            ]),
            command: hermescFilePath,
          }),
          directoryPath,
        ],
      ]);
    });

    it('should bundle the JavaScript as it is when the platform switched Hermes off, from index.<platform>.js where the project has one', async () => {
      const directoryPath = writeProject();
      writeFile(
        join(directoryPath, 'android', 'gradle.properties'),
        'newArchEnabled=true\nhermesEnabled=false\n',
      );
      writeFile(join(directoryPath, 'index.android.js'), '// android entry\n');
      const packagingDirectoryPath = join(directoryPath, 'packaging');

      await reactNativeFramework.packageBundles?.({
        packagingDirectoryPath,
        path: undefined,
        platforms: ['android'],
        projectDirectoryPath: directoryPath,
      });

      expect(vi.mocked(runCommandLineVisibly).mock.calls).toEqual([
        [
          {
            args: [
              'react-native',
              'bundle',
              '--platform',
              'android',
              '--dev',
              'false',
              '--entry-file',
              'index.android.js',
              '--bundle-output',
              join(packagingDirectoryPath, 'android', 'index.android.bundle'),
              '--assets-dest',
              join(packagingDirectoryPath, 'android'),
              '--reset-cache',
            ],
            command: 'npx',
          },
          directoryPath,
        ],
      ]);
    });

    it("should refuse an app on Hermes whose react-native lacks Hermes' compiler", async () => {
      const directoryPath = writeProject();

      await expect(
        (async () =>
          reactNativeFramework.packageBundles?.({
            packagingDirectoryPath: join(directoryPath, 'packaging'),
            path: undefined,
            platforms: ['ios'],
            projectDirectoryPath: directoryPath,
          }))(),
      ).rejects.toThrow(InvalidParameterError);
      expect(runCommandLineVisibly).not.toHaveBeenCalled();
    });

    it('should take --path as the prepared bundle of the one platform named, and bundle nothing', async () => {
      const directoryPath = writeProject();

      expect(
        await reactNativeFramework.packageBundles?.({
          packagingDirectoryPath: join(directoryPath, 'packaging'),
          path: join(directoryPath, 'export'),
          platforms: ['ios'],
          projectDirectoryPath: directoryPath,
        }),
      ).toEqual([
        { directoryPath: join(directoryPath, 'export'), platforms: ['ios'] },
      ]);
      expect(runCommandLineVisibly).not.toHaveBeenCalled();
    });

    it('should refuse --path without the one platform it serves', async () => {
      const directoryPath = writeProject();

      await expect(
        (async () =>
          reactNativeFramework.packageBundles?.({
            packagingDirectoryPath: join(directoryPath, 'packaging'),
            path: join(directoryPath, 'export'),
            platforms: undefined,
            projectDirectoryPath: directoryPath,
          }))(),
      ).rejects.toThrow(InvalidParameterError);
    });
  });

  describe('readBinaryIdentity', () => {
    it('should name the flag the native build passes the identity in with', () => {
      expect(() =>
        reactNativeFramework.readBinaryIdentity('ios', writeProject()),
      ).toThrow(new MissingParameterError('--binary-version'));
    });
  });

  describe('resolveWiring', () => {
    it('should name every file a fresh project gets wired in', async () => {
      const directoryPath = writeProject();

      const wiring = await reactNativeFramework.resolveWiring(
        readProject(directoryPath),
        { yes: true },
      );

      expect(wiring.isPackageInstalled).toBe(false);
      expect(wiring.packageFilePaths).toEqual(['package.json']);
      expect(wiring.nativeFilePaths).toEqual([
        XCODE_PROJECT_FILE_PATH,
        APP_GRADLE_FILE_PATH,
        APP_DELEGATE_FILE_PATH,
        MAIN_APPLICATION_FILE_PATH,
        PODFILE_PATH,
      ]);
    });

    it('should install the SDK from its pinned build with the package manager of the project', async () => {
      const directoryPath = writeProject();
      const wiring = await reactNativeFramework.resolveWiring(
        readProject(directoryPath),
        { yes: true },
      );

      expect(wiring.installPackage()).toMatch(
        /^installed @hotcodepush\/react-native-code-push from https:\/\/pkg\.pr\.new\/hotcodepush-team\/react-native-code-push\/@hotcodepush\/react-native-code-push@[0-9a-f]{7}$/,
      );
      expect(runCommandLineVisibly).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'npm' }),
        directoryPath,
      );
    });

    describe('wireBinaryCreateStep', () => {
      it('should wire the phase, the Gradle line, both apps and the pod, then run pod install', async () => {
        const directoryPath = writeProject({ isPackageInstalled: true });
        writeInstalledSdk(directoryPath);
        const wiring = await reactNativeFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        const outcome = await wiring.wireBinaryCreateStep(undefined);

        expect(outcome).toEqual({
          message:
            'wired the Create HotCodePush binary phase in Xcode, the Gradle task that runs binary create, HotCodePush.bundleURL() in AppDelegate.swift, HotCodePushReactHost in MainApplication.kt, the HotCodePushProtocol pod in the Podfile, the pods through pod install',
          status: 'done',
          value: undefined,
        });
        expect(runCommandLineVisibly).toHaveBeenCalledWith(
          { args: ['install'], command: 'pod' },
          join(directoryPath, 'ios'),
        );
        expect(
          (
            await reactNativeFramework.resolveWiring(
              readProject(directoryPath),
              { yes: true },
            )
          ).nativeFilePaths,
        ).toEqual([]);
      });

      it('should skip what is wired and run nothing once the pods hold the SDK', async () => {
        const directoryPath = writeProject({ isPackageInstalled: true });
        writeInstalledSdk(directoryPath);
        const options = { yes: true };
        await (
          await reactNativeFramework.resolveWiring(
            readProject(directoryPath),
            options,
          )
        ).wireBinaryCreateStep(undefined);
        writeFile(
          join(directoryPath, 'ios', 'Podfile.lock'),
          'PODS:\n  - HotcodepushReactNativeCodePush (0.1.0)\n',
        );
        vi.mocked(runCommandLineVisibly).mockReset();

        const outcome = await (
          await reactNativeFramework.resolveWiring(
            readProject(directoryPath),
            options,
          )
        ).wireBinaryCreateStep(undefined);

        expect(outcome).toEqual({
          message: 'binary create and the bundle wiring already wired',
          status: 'skipped',
          value: undefined,
        });
        expect(runCommandLineVisibly).not.toHaveBeenCalled();
      });

      it('should change no file when the edits are not confirmed', async () => {
        const directoryPath = writeProject({ isPackageInstalled: true });
        const wiring = await reactNativeFramework.resolveWiring(
          readProject(directoryPath),
          {},
        );
        const editBlocker = new ConfirmationRequiredError('changes files');

        await expect(wiring.wireBinaryCreateStep(editBlocker)).rejects.toBe(
          editBlocker,
        );
        expect(
          readProjectFile(directoryPath, APP_GRADLE_FILE_PATH),
        ).not.toContain('hotcodepush.gradle');
      });

      it('should make the edits it can and stop with the manual step of the one it cannot', async () => {
        const directoryPath = writeProject({ isPackageInstalled: true });
        writeInstalledSdk(directoryPath);
        writeFile(
          join(directoryPath, MAIN_APPLICATION_FILE_PATH),
          'package com.example.demo\n\nclass MainApplication\n',
        );
        const wiring = await reactNativeFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        await expect(wiring.wireBinaryCreateStep(undefined)).rejects.toThrow(
          NativeProjectError,
        );

        expect(readProjectFile(directoryPath, APP_GRADLE_FILE_PATH)).toContain(
          'hotcodepush.gradle',
        );
        expect(
          readProjectFile(directoryPath, APP_DELEGATE_FILE_PATH),
        ).toContain('HotCodePush.bundleURL()');
        expect(runCommandLineVisibly).not.toHaveBeenCalled();
      });

      it('should stop with the missing native projects when neither exists', async () => {
        const directoryPath = writeProject({ isPackageInstalled: true });
        rmSync(join(directoryPath, 'ios'), { recursive: true });
        rmSync(join(directoryPath, 'android'), { recursive: true });
        const wiring = await reactNativeFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        await expect(wiring.wireBinaryCreateStep(undefined)).rejects.toThrow(
          new MissingParameterError(
            '--ios-path',
            'pass --ios-path and --android-path; neither ios nor android exists.',
          ),
        );
      });
    });
  });

  describe('checkWiring', () => {
    it('should fail the hook and the host of a project nothing is wired in, naming the files', () => {
      const directoryPath = writeProject({ isPackageInstalled: true });

      expect(
        reactNativeFramework.checkWiring(readProject(directoryPath)).slice(1),
      ).toEqual([
        {
          check: 'hook',
          manualStep: 'run hotcodepush init',
          message: `not wired in the Xcode project and ${APP_GRADLE_FILE_PATH}`,
          status: 'failed',
        },
        {
          check: 'host',
          manualStep: 'run hotcodepush init',
          message: `not wired in ${APP_DELEGATE_FILE_PATH} and ${MAIN_APPLICATION_FILE_PATH}`,
          status: 'failed',
        },
      ]);
    });

    it('should report the hook and the host of a wired project', async () => {
      const directoryPath = writeProject({ isPackageInstalled: true });
      writeInstalledSdk(directoryPath);
      await (
        await reactNativeFramework.resolveWiring(readProject(directoryPath), {
          yes: true,
        })
      ).wireBinaryCreateStep(undefined);

      expect(
        reactNativeFramework.checkWiring(readProject(directoryPath)),
      ).toEqual([
        {
          check: 'package',
          message: '@hotcodepush/react-native-code-push 0.1.0 installed',
          status: 'ok',
        },
        {
          check: 'hook',
          message: 'the Xcode phase and the Gradle task run binary create',
          status: 'ok',
        },
        {
          check: 'host',
          message: 'React Native runs the bundle the SDK serves',
          status: 'ok',
        },
      ]);
    });

    it('should skip the hook and the host without a native project', () => {
      const directoryPath = writeProject({ isPackageInstalled: true });
      rmSync(join(directoryPath, 'ios'), { recursive: true });
      rmSync(join(directoryPath, 'android'), { recursive: true });

      expect(
        reactNativeFramework
          .checkWiring(readProject(directoryPath))
          .slice(1)
          .map(({ check, status }) => `${check}:${status}`),
      ).toEqual(['hook:skipped', 'host:skipped']);
    });
  });
});
