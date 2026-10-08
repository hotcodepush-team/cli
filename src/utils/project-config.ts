import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ProjectConfigurationSchema } from '@hotcodepush/protocol';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { InvalidParameterError } from './errors.js';
import { readJsonFile, stringifyLikeSource } from './json-file.js';

/**
 * `hotcodepush.json`, the project's configuration, as written: `init` writes it and completes a partial one, so every key is optional.
 */
export type ProjectConfig = Partial<z.input<typeof ProjectConfigurationSchema>>;

/**
 * The project's configuration file with the directory it lies in, the project root every path is relative to.
 */
export interface ProjectConfigFileLocation {
  directoryPath: string;
  /** The file the configuration is read from; none without a file. */
  filePath: string | undefined;
}

/**
 * The project's configuration as read from its file.
 */
export interface ProjectConfigLocation extends ProjectConfigFileLocation {
  projectConfig: ProjectConfig | undefined;
}

const ID_SCHEMA = z.guid();

/**
 * The app id of the file, checked before a command uses it without asking the API:
 * the file comes with the repository, and the id reaches console URLs, the browser and the resource file devices read.
 */
export function assertProjectConfigAppId(appId: string): void {
  if (!ID_SCHEMA.safeParse(appId).success) {
    throw new InvalidParameterError(
      `${PROJECT_CONFIG_FILE_NAME}: appId is no id`,
      undefined,
      'set appId to the id "hotcodepush app list" prints.',
    );
  }
}

/**
 * The channel the project follows, by name or by id: `channel`, or `production`, the schema's default, when the file names none.
 */
export function resolveProjectChannel(projectConfig: ProjectConfig): string {
  return (
    projectConfig.channel ??
    ProjectConfigurationSchema.shape.channel.parse(undefined)
  );
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
  const fileLocation = locateProjectConfigFile(configPath);
  return {
    ...fileLocation,
    projectConfig:
      fileLocation.filePath === undefined
        ? undefined
        : readProjectConfigFile(fileLocation.filePath),
  };
}

/**
 * The configuration's file and its directory, the file not read yet, so `doctor` reports one that does not parse.
 */
export function locateProjectConfigFile(
  configPath: string | undefined,
): ProjectConfigFileLocation {
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
  return {
    directoryPath: filePath === undefined ? process.cwd() : dirname(filePath),
    filePath,
  };
}

export function readProjectConfigFile(filePath: string): ProjectConfig {
  return readJsonFile(filePath) as ProjectConfig;
}

/**
 * The configuration written back into its file with the indentation the file had, so an edit is the lines it means.
 */
export function writeProjectConfig(
  filePath: string,
  projectConfig: ProjectConfig,
): void {
  writeFileSync(
    filePath,
    stringifyLikeSource(projectConfig, readFileSync(filePath, 'utf8')),
  );
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
