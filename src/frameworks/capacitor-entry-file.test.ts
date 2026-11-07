import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPACITOR_ENTRY_FILE_PATH,
  writeCapacitorProject,
} from '../../test/capacitor-project.js';
import type { CapacitorProjectOptions } from '../../test/capacitor-project.js';
import {
  isSdkImported,
  resolveEntryFilePath,
  writeSdkImport,
} from './capacitor-entry-file.js';

const SDK_IMPORT_LINE = "import '@hotcodepush/capacitor-live-updates';\n";

describe('capacitor-entry-file', () => {
  const directoryPaths: string[] = [];

  function writeProject(options: CapacitorProjectOptions = {}): string {
    const directoryPath = writeCapacitorProject(options);
    directoryPaths.push(directoryPath);
    return directoryPath;
  }

  function writeRootEntryFile(
    directoryPath: string,
    { source }: { source: string },
  ): string {
    const entryFilePath = join(directoryPath, 'main.ts');
    writeFileSync(entryFilePath, source);
    writeFileSync(
      join(directoryPath, 'index.html'),
      '<script type="module" src="/main.ts"></script>',
    );
    return entryFilePath;
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
        '<script src="https://cdn.example.com/analytics.js"></script>\n<script type="module" src="/src/main.ts"></script>',
      );

      expect(resolveEntryFilePath(directoryPath)).toBe(
        join(directoryPath, CAPACITOR_ENTRY_FILE_PATH),
      );
    });

    it('should read the entry file beside index.html, where the Vite vanilla template places it', () => {
      const directoryPath = writeProject();
      const entryFilePath = writeRootEntryFile(directoryPath, { source: '' });

      expect(resolveEntryFilePath(directoryPath)).toBe(entryFilePath);
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

    it('should resolve no entry file when the named file is missing or no script', () => {
      const directoryPath = writeProject();
      writeFileSync(
        join(directoryPath, 'index.html'),
        '<script type="module" src="/src/missing.ts"></script>',
      );

      expect(resolveEntryFilePath(directoryPath)).toBeUndefined();
    });
  });

  describe('isSdkImported', () => {
    it('should find the import in a file under src/ other than the entry file', () => {
      const directoryPath = writeProject({ isSdkImported: false });
      mkdirSync(join(directoryPath, 'src', 'app'));
      writeFileSync(
        join(directoryPath, 'src', 'app', 'live-updates.ts'),
        SDK_IMPORT_LINE,
      );

      expect(
        isSdkImported(directoryPath, {
          entryFilePath: join(directoryPath, CAPACITOR_ENTRY_FILE_PATH),
        }),
      ).toBe(true);
    });

    it('should find the import in an entry file outside src/', () => {
      const directoryPath = writeProject({ isSdkImported: false });
      const entryFilePath = writeRootEntryFile(directoryPath, {
        source: SDK_IMPORT_LINE,
      });

      expect(isSdkImported(directoryPath, { entryFilePath })).toBe(true);
    });
  });

  describe('writeSdkImport', () => {
    function applyImport(directoryPath: string, source: string): string {
      const entryFilePath = join(directoryPath, CAPACITOR_ENTRY_FILE_PATH);
      writeFileSync(entryFilePath, source);
      writeSdkImport(entryFilePath);
      return readFileSync(entryFilePath, 'utf8');
    }

    it('should insert the import before the first import line, keeping the lines above it', () => {
      const directoryPath = writeProject({ isSdkImported: false });

      expect(
        applyImport(
          directoryPath,
          "/* Demo license */\n/// <reference types=\"vite/client\" />\nimport { createApp } from 'vue';\n\ncreateApp({}).mount('#app');\n",
        ),
      ).toBe(
        "/* Demo license */\n/// <reference types=\"vite/client\" />\nimport '@hotcodepush/capacitor-live-updates';\nimport { createApp } from 'vue';\n\ncreateApp({}).mount('#app');\n",
      );
    });

    it('should insert the import at the top when the file has no import line', () => {
      const directoryPath = writeProject({ isSdkImported: false });

      expect(applyImport(directoryPath, "console.log('demo');\n")).toBe(
        "import '@hotcodepush/capacitor-live-updates';\nconsole.log('demo');\n",
      );
    });

    it('should quote the package as the first import line does', () => {
      const directoryPath = writeProject({ isSdkImported: false });

      expect(
        applyImport(directoryPath, 'import { createApp } from "vue";\n'),
      ).toBe(
        'import "@hotcodepush/capacitor-live-updates";\nimport { createApp } from "vue";\n',
      );
    });

    it('should keep the line endings of a file written with CRLF', () => {
      const directoryPath = writeProject({ isSdkImported: false });

      expect(
        applyImport(directoryPath, "import { createApp } from 'vue';\r\n"),
      ).toBe(
        "import '@hotcodepush/capacitor-live-updates';\r\nimport { createApp } from 'vue';\r\n",
      );
    });
  });
});
