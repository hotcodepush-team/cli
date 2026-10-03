import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ProjectConfigurationSchema } from '@hotcodepush/protocol';
import { z } from 'zod';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { stringifyLikeSource } from './embed-hook.js';
import { InvalidParameterError } from './errors.js';

/**
 * `hotcodepush.json`, the project's configuration, as written: `init` writes it and completes a partial one, so every key is optional.
 * `channelId`, the channel by id, is the key `channel` replaced, read for one more release.
 */
export type ProjectConfig = Partial<
  z.input<typeof ProjectConfigurationSchema>
> & {
  channelId?: string;
};

/**
 * The project's configuration with the directory it lies in, the project root every path is relative to.
 */
export interface ProjectConfigLocation {
  directoryPath: string;
  /** The file the configuration was read from; none without a file. */
  filePath: string | undefined;
  projectConfig: ProjectConfig | undefined;
}

const ID_SCHEMA = z.guid();

let isChannelIdNoticePrinted = false;

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
 * The channel the project follows: `channel` by name, `production`, the schema's default, when the file names none,
 * or the deprecated `channelId` by id while a file still carries it alone.
 */
export function resolveProjectChannel(projectConfig: ProjectConfig): string {
  return (
    projectConfig.channel ??
    projectConfig.channelId ??
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
 * A file still carrying `channelId` gets one deprecation notice on stderr per run.
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
    return {
      directoryPath: process.cwd(),
      filePath: undefined,
      projectConfig: undefined,
    };
  }
  const projectConfig = JSON.parse(
    readFileSync(filePath, 'utf8'),
  ) as ProjectConfig;
  if (projectConfig.channelId !== undefined) {
    printChannelIdNotice();
  }
  return { directoryPath: dirname(filePath), filePath, projectConfig };
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

function printChannelIdNotice(): void {
  if (isChannelIdNoticePrinted) {
    return;
  }
  isChannelIdNoticePrinted = true;
  process.stderr.write(
    `Warning: ${PROJECT_CONFIG_FILE_NAME}'s channelId is deprecated and read for one more release; replace it with "channel", the channel's name.\n`,
  );
}
