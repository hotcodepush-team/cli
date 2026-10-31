import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ProjectConfigurationSchema } from '@hotcodepush/protocol';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { InvalidParameterError } from './errors.js';
import { readJsonFile, stringifyLikeSource } from './json-file.js';

// `init` completes a partial file, so every key is optional.
export type ProjectConfig = Partial<z.input<typeof ProjectConfigurationSchema>>;

// The directory is the project root that every path is relative to.
export interface ProjectConfigFileLocation {
  directoryPath: string;
  filePath: string | undefined;
}

export interface ProjectConfigLocation extends ProjectConfigFileLocation {
  projectConfig: ProjectConfig | undefined;
}

export const ID_SCHEMA = z.guid();

// The file comes with the repository, and the id reaches console URLs, the browser and the resource file.
export function assertProjectConfigAppId(appId: string): void {
  if (!ID_SCHEMA.safeParse(appId).success) {
    throw new InvalidParameterError(
      `The appId in ${PROJECT_CONFIG_FILE_NAME} is not an id.`,
      'Set appId to the id "hotcodepush app list" prints.',
    );
  }
}

export function resolveProjectChannel(projectConfig: ProjectConfig): string {
  return (
    projectConfig.channel ??
    ProjectConfigurationSchema.shape.channel.parse(undefined)
  );
}

// Walks up from the working directory to the nearest file, the way git finds its root.
export function readProjectConfig(
  configPath: string | undefined,
): ProjectConfig | undefined {
  return locateProjectConfig(configPath).projectConfig;
}

// Without a file, the working directory is the project root.
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

// The file is not read yet, so `doctor` can report one that does not parse.
export function locateProjectConfigFile(
  configPath: string | undefined,
): ProjectConfigFileLocation {
  if (configPath !== undefined && !existsSync(configPath)) {
    throw new InvalidParameterError(
      `The file ${configPath} from --config does not exist.`,
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
