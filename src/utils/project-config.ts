import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PROJECT_CONFIG_FILE_NAME } from '../config/consts.js';
import { InvalidParameterError } from './errors.js';

/**
 * `hotcodepush.json`, the project's configuration, as far as the commands read it; `init` writes it.
 */
export interface ProjectConfig {
  appId?: string;
  channelId?: string;
}

/**
 * The file `--config` names, or the nearest `hotcodepush.json` walking up from the working directory, the way git finds its root;
 * none found is no configuration, a named file that is missing a wrong parameter.
 */
export function readProjectConfig(
  configPath: string | undefined,
): ProjectConfig | undefined {
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
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, 'utf8')) as ProjectConfig;
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
