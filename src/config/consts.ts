import { createRequire } from 'node:module';
import type { CliMeta } from '../utils/cli.js';

export const CLI_CLIENT_ID = 'hotcodepush-cli';
export const CLIENT_HEADER_NAME = 'X-HotCodePush-Client';
export const CONFIG_DIRECTORY_NAME = 'hotcodepush';
export const CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_API_URL = 'https://api.hotcodepush.com';
export const ERRORS_DOCS_URL = 'https://hotcodepush.com/docs/cli/errors';
export const ISSUES_URL = 'https://github.com/hotcodepush-team/cli/issues';
export const KEYRING_ACCOUNT_NAME = 'token';
export const KEYRING_SERVICE_NAME = 'hotcodepush-cli';
export const PACKAGE_JSON: CliMeta = createRequire(import.meta.url)(
  '../../package.json',
);
export const PROJECT_CONFIG_FILE_NAME = 'hotcodepush.json';
