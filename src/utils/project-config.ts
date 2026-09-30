import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { InvalidParameterError } from './errors.js';

/**
 * `hotcodepush.json`, the project's configuration, as far as the commands read it; `init` writes it.
 */
export interface ProjectConfig {
  appId?: string;
  channelId?: string;
  dir?: string;
}

/**
 * The project's configuration with the directory it lies in, the project root every path is relative to.
 */
export interface ProjectConfigLocation {
  directoryPath: string;
  projectConfig: ProjectConfig | undefined;
}

const ID_SCHEMA = z.guid();

/**
 * An id of the file, checked before a command uses it without asking the API:
 * the file comes with the repository, and its ids reach console URLs, the browser and the resource file devices read.
 */
export function assertProjectConfigId(
  field: 'appId' | 'channelId',
  id: string,
): void {
  if (!ID_SCHEMA.safeParse(id).success) {
    throw new InvalidParameterError(
      `${PROJECT_CONFIG_FILE_NAME}: ${field} is no id`,
      undefined,
      `set ${field} to the id "hotcodepush ${field === 'appId' ? 'app' : 'channel'} list" prints.`,
    );
  }
}

/**
 * The file `--config` names, or the nearest `hotcodepush.json` walking up from the working directory, the way git finds its root;
 * none found is no configuration, a named file that is missing a wrong parameter.
 */
export function readProjectConfig(
  configPath: string | undefined,
): ProjectConfig | undefined {
  return locateProjectConfig(configPath).projectConfig;
}

/**
 * The configuration and its directory; without a file the working directory is the project root.
 */
export function locateProjectConfig(
  configPath: string | undefined,
): ProjectConfigLocation {
  if (configPath !== undefined && !existsSync(configPath)) {
    throw new InvalidParameterError(
      `--config: there is no file at ${configPath}`,
      undefined,
    );
  }
  const filePath =
    configPath === undefined
      ? findProjectConfigFilePath(process.cwd())
      : resolve(configPath);
  if (filePath === undefined) {
    return { directoryPath: process.cwd(), projectConfig: undefined };
  }
  return {
    directoryPath: dirname(filePath),
    projectConfig: JSON.parse(readFileSync(filePath, 'utf8')) as ProjectConfig,
  };
}

function findProjectConfigFilePath(directoryPath: string): string | undefined {
  const filePath = join(directoryPath, PROJECT_CONFIG_FILE_NAME);
  if (existsSync(filePath)) {
    return filePath;
  }
  const parentDirectoryPath = dirname(directoryPath);
  return parentDirectoryPath === directoryPath
    ? undefined
    : findProjectConfigFilePath(parentDirectoryPath);
}
