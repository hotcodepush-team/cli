import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

  describe('packageBundles', () => {
    it('should bundle with react-native bundle from index.js', async () => {
      const directoryPath = writeProject();
      // without Hermes the bundler is the one command an Android bundle runs
      writeFile(
        join(directoryPath, 'android', 'gradle.properties'),
        'hermesEnabled=false\n',
      );

      await reactNativeFramework.packageBundles?.({
        packagingDirectoryPath: join(directoryPath, 'packaging'),
        path: undefined,
        platforms: ['android'],
        projectDirectoryPath: directoryPath,
      });

      expect(
        vi.mocked(runCommandLineVisibly).mock.calls[0]?.[0].args.slice(0, 4),
      ).toEqual(['react-native', 'bundle', '--entry-file', 'index.js']);
    });

    it('should bundle from index.android.js where the project has one', async () => {
      const directoryPath = writeProject();
      // without Hermes the bundler is the one command an Android bundle runs
      writeFile(
        join(directoryPath, 'android', 'gradle.properties'),
        'hermesEnabled=false\n',
      );
      writeFile(join(directoryPath, 'index.android.js'), '// android entry\n');

      await reactNativeFramework.packageBundles?.({
        packagingDirectoryPath: join(directoryPath, 'packaging'),
        path: undefined,
        platforms: ['android'],
        projectDirectoryPath: directoryPath,
      });

      expect(
        vi.mocked(runCommandLineVisibly).mock.calls[0]?.[0].args.slice(0, 4),
      ).toEqual(['react-native', 'bundle', '--entry-file', 'index.android.js']);
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

    it('should install the SDK from its pinned build', async () => {
      const wiring = await reactNativeFramework.resolveWiring(
        readProject(writeProject()),
        { yes: true },
      );

      expect(wiring.installPackage()).toMatch(
        /^installed @hotcodepush\/react-native-code-push from https:\/\/pkg\.pr\.new\/hotcodepush-team\/react-native-code-push\/@hotcodepush\/react-native-code-push@[0-9a-f]{7}$/,
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
            'wired the Create HotCodePush binary phase in Xcode, the Gradle task that runs the build step, HotCodePush.bundleURL() in AppDelegate.swift, HotCodePushReactHost in MainApplication.kt, the HotCodePushCore pod in the Podfile, the pods through pod install',
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

      it("should add the phase after React Native's bundling, running the SDK package script through with-environment.sh", async () => {
        const directoryPath = writeProject({ isPackageInstalled: true });
        writeInstalledSdk(directoryPath);

        await (
          await reactNativeFramework.resolveWiring(readProject(directoryPath), {
            yes: true,
          })
        ).wireBinaryCreateStep(undefined);

        const projectText = readProjectFile(
          directoryPath,
          XCODE_PROJECT_FILE_PATH,
        );
        expect(projectText).toMatch(
          /\/\* Bundle React Native code and images \*\/,\n\t+[0-9A-F]+ \/\* Create HotCodePush binary \*\/,/,
        );
        expect(projectText).toContain(
          'shellScript = "set -e\\n\\n# hotcodepush: writes hotcodepush.json into the app and, in a store build, creates the binary\\nWITH_ENVIRONMENT=\\"$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh\\"\\nHOTCODEPUSH_BINARY_CREATE=\\"$REACT_NATIVE_PATH/../@hotcodepush/react-native-code-push/scripts/binary-create-xcode.sh\\"\\n\\n/bin/sh -c \\"$WITH_ENVIRONMENT $HOTCODEPUSH_BINARY_CREATE\\"\\n";',
        );
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
          message: 'the build step and the bundle wiring already wired',
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
          message: 'the Xcode phase and the Gradle task run the build step',
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
