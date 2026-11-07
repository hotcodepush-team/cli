import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPACITOR_ENTRY_FILE_PATH,
  writeCapacitorProject,
} from '../../test/capacitor-project.js';
import type { CapacitorProjectOptions } from '../../test/capacitor-project.js';
import {
  resolveEntryFilePath,
  resolveSdkImportEdit,
} from './capacitor-entry-file.js';

describe('capacitor-entry-file', () => {
  const directoryPaths: string[] = [];

  function writeProject(options: CapacitorProjectOptions = {}): string {
    const directoryPath = writeCapacitorProject(options);
    directoryPaths.push(directoryPath);
    return directoryPath;
  }

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  describe('resolveEntryFilePath', () => {
    it('should read the entry file from the first local module script of index.html', () => {
      const directoryPath = writeProject();
      writeFileSync(
        join(directoryPath, 'index.html'),
        [
          '<script src="https://cdn.example.com/widget.js" type="module"></script>',
          '<script src="/src/main.ts" type="module"></script>',
        ].join('\n'),
      );

      expect(resolveEntryFilePath(directoryPath)).toBe(
        join(directoryPath, CAPACITOR_ENTRY_FILE_PATH),
      );
    });

    it('should read the entry file from the browser build option of angular.json', () => {
      const directoryPath = writeProject({
        entryFileDeclaration: 'angular_json',
      });

      expect(resolveEntryFilePath(directoryPath)).toBe(
        join(directoryPath, CAPACITOR_ENTRY_FILE_PATH),
      );
    });

    it('should read the entry file from the targets key an Nx workspace writes in angular.json', () => {
      const directoryPath = writeProject();
      writeFileSync(
        join(directoryPath, 'angular.json'),
        JSON.stringify({
          projects: {
            demo: { targets: { build: { options: { main: 'src/main.ts' } } } },
          },
        }),
      );

      expect(resolveEntryFilePath(directoryPath)).toBe(
        join(directoryPath, CAPACITOR_ENTRY_FILE_PATH),
      );
    });

    it('should resolve no entry file when neither index.html nor angular.json exists', () => {
      const directoryPath = writeProject();

      expect(resolveEntryFilePath(directoryPath)).toBeUndefined();
    });

    it('should resolve no entry file when the named file lies outside src/, since the import check would not find the edit', () => {
      const directoryPath = writeProject();
      writeFileSync(join(directoryPath, 'main.js'), '');
      writeFileSync(
        join(directoryPath, 'index.html'),
        '<script type="module" src="/main.js"></script>',
      );

      expect(resolveEntryFilePath(directoryPath)).toBeUndefined();
    });
  });

  describe('resolveSdkImportEdit', () => {
    function applyEdit(directoryPath: string, source: string): string {
      const entryFilePath = join(directoryPath, CAPACITOR_ENTRY_FILE_PATH);
      writeFileSync(entryFilePath, source);
      resolveSdkImportEdit(directoryPath, { entryFilePath }).apply();
      return readFileSync(entryFilePath, 'utf8');
    }

    it('should insert the import before the first import line, keeping the lines above it', () => {
      const directoryPath = writeProject({ isSdkImported: false });

      expect(
        applyEdit(
          directoryPath,
          "/* Demo license */\n/// <reference types=\"vite/client\" />\nimport { createApp } from 'vue';\n\ncreateApp({}).mount('#app');\n",
        ),
      ).toBe(
        "/* Demo license */\n/// <reference types=\"vite/client\" />\nimport '@hotcodepush/capacitor-live-updates';\nimport { createApp } from 'vue';\n\ncreateApp({}).mount('#app');\n",
      );
    });

    it('should insert the import at the top when the file has no import line', () => {
      const directoryPath = writeProject({ isSdkImported: false });

      expect(applyEdit(directoryPath, "console.log('demo');\n")).toBe(
        "import '@hotcodepush/capacitor-live-updates';\nconsole.log('demo');\n",
      );
    });

    it('should quote the package as the first import line does', () => {
      const directoryPath = writeProject({ isSdkImported: false });

      expect(
        applyEdit(directoryPath, 'import { createApp } from "vue";\n'),
      ).toBe(
        'import "@hotcodepush/capacitor-live-updates";\nimport { createApp } from "vue";\n',
      );
    });

    it('should count the edit as applied when any file under src/ imports the package', () => {
      const directoryPath = writeProject({ isSdkImported: false });
      mkdirSync(join(directoryPath, 'src', 'app'));
      writeFileSync(
        join(directoryPath, 'src', 'app', 'live-updates.ts'),
        "import '@hotcodepush/capacitor-live-updates';\n",
      );

      expect(
        resolveSdkImportEdit(directoryPath, {
          entryFilePath: join(directoryPath, CAPACITOR_ENTRY_FILE_PATH),
        }).isApplied(),
      ).toBe(true);
    });
  });
});
