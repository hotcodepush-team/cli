import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { CAPACITOR_PACKAGE_NAME } from '../config/consts.js';
import type { ProjectEdit } from './project-edit.js';

interface AngularBuildOptions {
  browser?: string;
  main?: string;
}

interface AngularWorkspace {
  projects?: Record<
    string,
    { architect?: { build?: { options?: AngularBuildOptions } } } | null
  >;
}

const ANGULAR_WORKSPACE_FILE_NAME = 'angular.json';

// Matches the quote character that opens an import's module name.
const IMPORT_QUOTE_PATTERN = /['"]/;

const INDEX_HTML_FILE_NAME = 'index.html';

// Matches a script tag's type attribute when its value is module.
const MODULE_TYPE_PATTERN = /\btype\s*=\s*["']module["']/i;

// Matches a source on another host: http://, https:// or a protocol-relative //.
const REMOTE_SOURCE_PATTERN = /^(?:https?:)?\/\//i;

// Captures the value of a script tag's src attribute.
const SCRIPT_SOURCE_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/i;

// Captures the attributes of a script tag, so its type and src match in either order.
const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>/gi;

// The import tells the SDK the app rendered. Without it, the SDK rolls every update back.
const SDK_IMPORT_PATTERN = new RegExp(`['"]${CAPACITOR_PACKAGE_NAME}['"]`);

export const WEB_SOURCE_DIRECTORY_NAME = 'src';

const WEB_SOURCE_FILE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
]);

export function isSdkImported(projectDirectoryPath: string): boolean {
  const sourceDirectoryPath = join(
    projectDirectoryPath,
    WEB_SOURCE_DIRECTORY_NAME,
  );
  return (
    existsSync(sourceDirectoryPath) &&
    readdirSync(sourceDirectoryPath, { recursive: true, withFileTypes: true })
      .filter(
        entry =>
          entry.isFile() && WEB_SOURCE_FILE_EXTENSIONS.has(extname(entry.name)),
      )
      .some(entry =>
        SDK_IMPORT_PATTERN.test(
          readFileSync(join(entry.parentPath, entry.name), 'utf8'),
        ),
      )
  );
}

// Only a file the import check reads counts as the entry, so `init` recognises its edit afterwards.
export function resolveEntryFilePath(
  projectDirectoryPath: string,
): string | undefined {
  const entryPath =
    readIndexHtmlEntryPath(projectDirectoryPath) ??
    readAngularEntryPath(projectDirectoryPath);
  if (entryPath === undefined) {
    return undefined;
  }
  // A leading slash means the project root, as Vite reads it.
  const entryFilePath = join(projectDirectoryPath, entryPath);
  return isWebSourceFile(projectDirectoryPath, { filePath: entryFilePath })
    ? entryFilePath
    : undefined;
}

export function resolveSdkImportEdit(
  projectDirectoryPath: string,
  { entryFilePath }: { entryFilePath: string },
): ProjectEdit {
  return {
    description: 'the import that reports the first render',
    filePath: entryFilePath,
    isApplied: () => isSdkImported(projectDirectoryPath),
    apply: () => {
      writeFileSync(
        entryFilePath,
        insertSdkImport(readFileSync(entryFilePath, 'utf8')),
      );
    },
  };
}

// Lines above the first import, such as a license header or a triple-slash directive, stay first.
function insertSdkImport(source: string): string {
  const lines = source.split('\n');
  const firstImportIndex = lines.findIndex(line => line.startsWith('import '));
  const quote =
    IMPORT_QUOTE_PATTERN.exec(lines[firstImportIndex] ?? '')?.[0] ?? "'";
  lines.splice(
    Math.max(firstImportIndex, 0),
    0,
    `import ${quote}${CAPACITOR_PACKAGE_NAME}${quote};`,
  );
  return lines.join('\n');
}

function isWebSourceFile(
  projectDirectoryPath: string,
  { filePath }: { filePath: string },
): boolean {
  const sourceRelativePath = relative(
    join(projectDirectoryPath, WEB_SOURCE_DIRECTORY_NAME),
    filePath,
  );
  return (
    !sourceRelativePath.startsWith(`..${sep}`) &&
    WEB_SOURCE_FILE_EXTENSIONS.has(extname(filePath)) &&
    existsSync(filePath)
  );
}

function parseAngularWorkspace(text: string): AngularWorkspace | undefined {
  try {
    return JSON.parse(text) as AngularWorkspace;
  } catch {
    return undefined;
  }
}

function readAngularEntryPath(
  projectDirectoryPath: string,
): string | undefined {
  const workspaceFilePath = join(
    projectDirectoryPath,
    ANGULAR_WORKSPACE_FILE_NAME,
  );
  if (!existsSync(workspaceFilePath)) {
    return undefined;
  }
  const workspace = parseAngularWorkspace(
    readFileSync(workspaceFilePath, 'utf8'),
  );
  return Object.values(workspace?.projects ?? {})
    .map(project => project?.architect?.build?.options)
    .map(options => options?.browser ?? options?.main)
    .find(entryPath => entryPath !== undefined);
}

function readIndexHtmlEntryPath(
  projectDirectoryPath: string,
): string | undefined {
  const indexHtmlFilePath = join(projectDirectoryPath, INDEX_HTML_FILE_NAME);
  if (!existsSync(indexHtmlFilePath)) {
    return undefined;
  }
  return [
    ...readFileSync(indexHtmlFilePath, 'utf8').matchAll(SCRIPT_TAG_PATTERN),
  ]
    .map(([, attributes = '']) => attributes)
    .filter(attributes => MODULE_TYPE_PATTERN.test(attributes))
    .map(attributes => SCRIPT_SOURCE_PATTERN.exec(attributes)?.[1])
    .find(
      source => source !== undefined && !REMOTE_SOURCE_PATTERN.test(source),
    );
}
