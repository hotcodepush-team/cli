import { join } from 'node:path';
import { readJsonFile } from './json-file.js';

export interface PackageJson {
  cordova?: { plugins?: Record<string, unknown> };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
  version?: string;
}

export function readPackageJson(projectDirectoryPath: string): PackageJson {
  return readJsonFile(
    join(projectDirectoryPath, 'package.json'),
  ) as PackageJson;
}
