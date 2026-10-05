import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationRequiredError, NativeProjectError } from '../errors.js';
import type * as packageManagerModule from '../package-manager.js';
import { runCommandLineVisibly } from '../package-manager.js';
import { expoFramework } from './expo.js';

vi.mock('../package-manager.js', async importOriginal => ({
  ...(await importOriginal<typeof packageManagerModule>()),
  runCommandLineVisibly: vi.fn(),
}));

const APP_JSON = `{
    "expo": {
        "name": "Demo",
        "plugins": [
            "expo-router"
        ]
    }
}
`;

// the comment and the trailing commas Expo's JSON5 reading allows
const APP_JSON5 = `{
  // the name on the home screen
  "expo": {
    "name": "Demo",
  },
}
`;

describe('expoFramework', () => {
  const directoryPaths: string[] = [];

  function writeFile(filePath: string, content: string): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  function writeProject(
    appConfig: { appJson?: string; codeFileName?: string } = {
      appJson: APP_JSON,
    },
  ): string {
    const directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-expo-'));
    directoryPaths.push(directoryPath);
    writeFile(
      join(directoryPath, 'package.json'),
      JSON.stringify({
        dependencies: { 'expo': '~55.0.31', 'react-native': '0.83.10' },
        name: 'demo',
      }),
    );
    if (appConfig.appJson !== undefined) {
      writeFile(join(directoryPath, 'app.json'), appConfig.appJson);
    }
    if (appConfig.codeFileName !== undefined) {
      writeFile(
        join(directoryPath, appConfig.codeFileName),
        'export default ({ config }) => ({ ...config, plugins: [] });\n',
      );
    }
    return directoryPath;
  }

  function readProject(directoryPath: string) {
    return {
      directoryPath,
      packageJson: JSON.parse(
        readFileSync(join(directoryPath, 'package.json'), 'utf8'),
      ),
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
    it('should bundle with Expo export:embed, the bundler its release builds run', async () => {
      const directoryPath = writeProject();
      // without Hermes the bundler is the one command an Android bundle runs
      writeFile(
        join(directoryPath, 'android', 'gradle.properties'),
        'hermesEnabled=false\n',
      );

      await expoFramework.packageBundles?.({
        packagingDirectoryPath: join(directoryPath, 'packaging'),
        path: undefined,
        platforms: ['android'],
        projectDirectoryPath: directoryPath,
      });

      expect(
        vi.mocked(runCommandLineVisibly).mock.calls[0]?.[0].args.slice(0, 2),
      ).toEqual(['expo', 'export:embed']);
    });
  });

  describe('resolveWiring', () => {
    it('should name package.json and app.json for a fresh project and no native file, which prebuild owns', async () => {
      const wiring = await expoFramework.resolveWiring(
        readProject(writeProject()),
        { yes: true },
      );

      expect(wiring.isPackageInstalled).toBe(false);
      expect(wiring.packageFilePaths).toEqual(['package.json', 'app.json']);
      expect(wiring.nativeFilePaths).toEqual([]);
    });

    it('should install the package from its pinned build', async () => {
      const wiring = await expoFramework.resolveWiring(
        readProject(writeProject()),
        { yes: true },
      );

      expect(wiring.installPackage()).toMatch(
        /^installed @hotcodepush\/expo-ota-updates from https:\/\/pkg\.pr\.new\/hotcodepush-team\/expo-ota-updates\/@hotcodepush\/expo-ota-updates@[0-9a-f]{7}$/,
      );
    });

    describe('wireBinaryCreateStep', () => {
      it("should add the config plugin to app.json's plugins, keeping the file's other keys and indentation", async () => {
        const directoryPath = writeProject();
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        const outcome = await wiring.wireBinaryCreateStep(undefined);

        expect(outcome).toEqual({
          message:
            'added the config plugin @hotcodepush/expo-ota-updates to app.json',
          status: 'done',
          value: undefined,
        });
        expect(readFileSync(join(directoryPath, 'app.json'), 'utf8')).toBe(
          APP_JSON.replace(
            '"expo-router"',
            '"expo-router",\n            "@hotcodepush/expo-ota-updates"',
          ),
        );
      });

      it('should skip when app.json lists the config plugin with its options', async () => {
        const directoryPath = writeProject({
          appJson: JSON.stringify({
            expo: { plugins: [['@hotcodepush/expo-ota-updates', {}]] },
          }),
        });
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        expect(await wiring.wireBinaryCreateStep(undefined)).toEqual({
          message: 'app.json already lists the config plugin',
          status: 'skipped',
          value: undefined,
        });
        expect(wiring.packageFilePaths).toEqual(['package.json']);
      });

      it('should add the config plugin at the top of an app.json without the expo key, where Expo reads it', async () => {
        const directoryPath = writeProject({
          appJson: JSON.stringify({ name: 'Demo' }),
        });
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        await wiring.wireBinaryCreateStep(undefined);

        expect(
          JSON.parse(readFileSync(join(directoryPath, 'app.json'), 'utf8')),
        ).toEqual({
          name: 'Demo',
          plugins: ['@hotcodepush/expo-ota-updates'],
        });
      });

      it('should write app.json with the config plugin when the project has no app config, as Expo writes one', async () => {
        const directoryPath = writeProject({});
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        await wiring.wireBinaryCreateStep(undefined);

        expect(wiring.packageFilePaths).toEqual(['package.json', 'app.json']);
        expect(
          JSON.parse(readFileSync(join(directoryPath, 'app.json'), 'utf8')),
        ).toEqual({ plugins: ['@hotcodepush/expo-ota-updates'] });
      });

      it('should add the config plugin to app.config.json, which Expo reads before app.json', async () => {
        const directoryPath = writeProject({});
        writeFile(join(directoryPath, 'app.config.json'), APP_JSON);
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        expect(await wiring.wireBinaryCreateStep(undefined)).toEqual({
          message:
            'added the config plugin @hotcodepush/expo-ota-updates to app.config.json',
          status: 'done',
          value: undefined,
        });
        expect(wiring.packageFilePaths).toEqual([
          'package.json',
          'app.config.json',
        ]);
        expect(
          readFileSync(join(directoryPath, 'app.config.json'), 'utf8'),
        ).toContain('"@hotcodepush/expo-ota-updates"');
      });

      it('should change no file when the edit is not confirmed', async () => {
        const directoryPath = writeProject();
        const editBlocker = new ConfirmationRequiredError(
          'changes app.json',
          'run init --yes to change app.json',
        );
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          {},
        );

        await expect(wiring.wireBinaryCreateStep(editBlocker)).rejects.toBe(
          editBlocker,
        );
        expect(readFileSync(join(directoryPath, 'app.json'), 'utf8')).toBe(
          APP_JSON,
        );
      });

      it('should stop with the entry to add when app.json is not JSON the CLI can parse', async () => {
        const directoryPath = writeProject({ appJson: APP_JSON5 });
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        await expect(wiring.wireBinaryCreateStep(undefined)).rejects.toThrow(
          new NativeProjectError(
            'app.json is not JSON the CLI can parse',
            'add "@hotcodepush/expo-ota-updates" to the plugins in app.json.',
          ),
        );
        expect(wiring.packageFilePaths).toEqual(['package.json']);
        expect(readFileSync(join(directoryPath, 'app.json'), 'utf8')).toBe(
          APP_JSON5,
        );
      });

      it('should stop with the entry to add when the app config is code', async () => {
        const directoryPath = writeProject({
          appJson: APP_JSON,
          codeFileName: 'app.config.ts',
        });
        const wiring = await expoFramework.resolveWiring(
          readProject(directoryPath),
          { yes: true },
        );

        await expect(wiring.wireBinaryCreateStep(undefined)).rejects.toThrow(
          new NativeProjectError(
            'app.config.ts is code the CLI does not edit',
            'add "@hotcodepush/expo-ota-updates" to the plugins in app.config.ts.',
          ),
        );
        expect(wiring.packageFilePaths).toEqual(['package.json']);
        expect(readFileSync(join(directoryPath, 'app.json'), 'utf8')).toBe(
          APP_JSON,
        );
      });
    });
  });

  describe('checkWiring', () => {
    it('should fail the hook of a project whose app.json lacks the config plugin, naming init', () => {
      expect(
        expoFramework.checkWiring(readProject(writeProject())).slice(1),
      ).toEqual([
        {
          check: 'hook',
          manualStep: 'run hotcodepush init',
          message:
            'app.json does not list the config plugin @hotcodepush/expo-ota-updates',
          status: 'failed',
        },
      ]);
    });

    it('should name the entry to add when app.json is not JSON the CLI can parse and lacks the config plugin', () => {
      const directoryPath = writeProject({ appJson: APP_JSON5 });

      expect(
        expoFramework.checkWiring(readProject(directoryPath)).slice(1),
      ).toEqual([
        {
          check: 'hook',
          manualStep:
            'add "@hotcodepush/expo-ota-updates" to the plugins in app.json',
          message:
            'app.json does not list the config plugin @hotcodepush/expo-ota-updates',
          status: 'failed',
        },
      ]);
    });

    it('should name the entry to add when an app config that is code lacks the config plugin', () => {
      const directoryPath = writeProject({ codeFileName: 'app.config.js' });

      expect(
        expoFramework.checkWiring(readProject(directoryPath)).slice(1),
      ).toEqual([
        {
          check: 'hook',
          manualStep:
            'add "@hotcodepush/expo-ota-updates" to the plugins in app.config.js',
          message:
            'app.config.js does not list the config plugin @hotcodepush/expo-ota-updates',
          status: 'failed',
        },
      ]);
    });

    it('should report the hook when app.json lists the config plugin beside an app config that is code', () => {
      const directoryPath = writeProject({
        appJson: JSON.stringify({
          expo: { plugins: ['@hotcodepush/expo-ota-updates'] },
        }),
        codeFileName: 'app.config.js',
      });

      expect(
        expoFramework.checkWiring(readProject(directoryPath)).slice(1),
      ).toEqual([
        {
          check: 'hook',
          message:
            'app.json lists the config plugin, which wires binary create at prebuild',
          status: 'ok',
        },
      ]);
    });

    it('should report the hook of an app config that is code and names the config plugin', () => {
      const directoryPath = writeProject({ codeFileName: 'app.config.ts' });
      writeFile(
        join(directoryPath, 'app.config.ts'),
        "export default { plugins: ['@hotcodepush/expo-ota-updates'] };\n",
      );

      expect(
        expoFramework.checkWiring(readProject(directoryPath)).slice(1),
      ).toEqual([
        {
          check: 'hook',
          message:
            'app.config.ts lists the config plugin, which wires binary create at prebuild',
          status: 'ok',
        },
      ]);
    });
  });
});
