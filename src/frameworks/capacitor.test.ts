import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPACITOR_ENTRY_FILE_PATH,
  writeCapacitorProject,
} from '../../test/capacitor-project.js';
import type { CapacitorProjectOptions } from '../../test/capacitor-project.js';
import { ConfirmationRequiredError } from '../utils/errors.js';
import { capacitorFramework } from './capacitor.js';
import type { FrameworkWiring } from './index.js';

describe('capacitorFramework', () => {
  const directoryPaths: string[] = [];

  function writeProject(options: CapacitorProjectOptions = {}): string {
    const directoryPath = writeCapacitorProject(options);
    directoryPaths.push(directoryPath);
    return directoryPath;
  }

  function resolveWiring(directoryPath: string): Promise<FrameworkWiring> {
    return capacitorFramework.resolveWiring(
      { directoryPath, packageJson: undefined },
      { yes: true },
    );
  }

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  describe('wireAppImport', () => {
    it("should skip the import when the app's code already imports the package", async () => {
      const directoryPath = writeProject({
        entryFileDeclaration: 'index_html',
      });
      const wiring = await resolveWiring(directoryPath);

      expect(wiring.appFilePaths).toEqual([]);
      await expect(wiring.wireAppImport?.(undefined)).resolves.toEqual({
        message:
          "The app's code already imports @hotcodepush/capacitor-live-updates.",
        status: 'skipped',
        value: undefined,
      });
    });

    it('should stop with `entry_file_unknown` and the import to add when no file names the entry file', async () => {
      const directoryPath = writeProject({ isSdkImported: false });
      const wiring = await resolveWiring(directoryPath);

      expect(wiring.appFilePaths).toEqual([]);
      await expect(wiring.wireAppImport?.(undefined)).rejects.toMatchObject({
        code: 'entry_file_unknown',
        fix: "Add \"import '@hotcodepush/capacitor-live-updates';\" to the app's entry file, such as src/main.ts.",
      });
    });

    it('should throw the edit blocker and leave the entry file alone when one is given', async () => {
      const directoryPath = writeProject({
        entryFileDeclaration: 'index_html',
        isSdkImported: false,
      });
      const wiring = await resolveWiring(directoryPath);
      const editBlocker = new ConfirmationRequiredError('changes files');

      await expect(wiring.wireAppImport?.(editBlocker)).rejects.toBe(
        editBlocker,
      );
      expect(
        readFileSync(join(directoryPath, CAPACITOR_ENTRY_FILE_PATH), 'utf8'),
      ).toBe("console.log('demo');\n");
    });

    it('should write the import into the entry file and name it among the files to change', async () => {
      const directoryPath = writeProject({
        entryFileDeclaration: 'index_html',
        isSdkImported: false,
      });
      const wiring = await resolveWiring(directoryPath);

      expect(wiring.appFilePaths).toEqual([CAPACITOR_ENTRY_FILE_PATH]);
      await expect(wiring.wireAppImport?.(undefined)).resolves.toEqual({
        message: `Wired the import in ${CAPACITOR_ENTRY_FILE_PATH}.`,
        status: 'done',
        value: undefined,
      });
      expect(
        readFileSync(join(directoryPath, CAPACITOR_ENTRY_FILE_PATH), 'utf8'),
      ).toBe(
        "import '@hotcodepush/capacitor-live-updates';\nconsole.log('demo');\n",
      );
    });
  });
});
