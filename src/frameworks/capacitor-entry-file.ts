import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { CAPACITOR_PACKAGE_NAME } from '../config/consts.js';

interface AngularBuildOptions {
  browser?: string;
  main?: string;
}

interface AngularBuildTarget {
  build?: { options?: AngularBuildOptions };
}

// Angular's schema accepts `targets` beside `architect`, and Nx workspaces write it.
interface AngularWorkspace {
  projects?: Record<
    string,
    { architect?: AngularBuildTarget; targets?: AngularBuildTarget } | null
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

export function isSdkImported(
  projectDirectoryPath: string,
  { entryFilePath }: { entryFilePath: string | undefined },
): boolean {
  return [
    ...(entryFilePath === undefined ? [] : [entryFilePath]),
    ...readWebSourceFilePaths(projectDirectoryPath),
  ].some(filePath => SDK_IMPORT_PATTERN.test(readFileSync(filePath, 'utf8')));
}

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
  return isWebSourceFile(entryFilePath) ? entryFilePath : undefined;
}

// Lines above the first import, such as a license header or a triple-slash directive, stay first.
export function writeSdkImport(entryFilePath: string): void {
  const source = readFileSync(entryFilePath, 'utf8');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(newline);
  const firstImportIndex = lines.findIndex(line => line.startsWith('import '));
  const quote =
    IMPORT_QUOTE_PATTERN.exec(lines[firstImportIndex] ?? '')?.[0] ?? "'";
  lines.splice(
    Math.max(firstImportIndex, 0),
    0,
    `import ${quote}${CAPACITOR_PACKAGE_NAME}${quote};`,
  );
  writeFileSync(entryFilePath, lines.join(newline));
}

function isWebSourceFile(filePath: string): boolean {
  return (
    WEB_SOURCE_FILE_EXTENSIONS.has(extname(filePath)) && existsSync(filePath)
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
    .map(project => (project?.architect ?? project?.targets)?.build?.options)
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

function readWebSourceFilePaths(projectDirectoryPath: string): string[] {
  const sourceDirectoryPath = join(
    projectDirectoryPath,
    WEB_SOURCE_DIRECTORY_NAME,
  );
  if (!existsSync(sourceDirectoryPath)) {
    return [];
  }
  return readdirSync(sourceDirectoryPath, {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      entry =>
        entry.isFile() && WEB_SOURCE_FILE_EXTENSIONS.has(extname(entry.name)),
    )
    .map(entry => join(entry.parentPath, entry.name));
}
