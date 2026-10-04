import { createRequire } from 'node:module';
import type { CliMeta } from '../utils/cli.js';

// An SDK is installed from the pkg.pr.new build of one commit until its package is published; a bump is one edit of the sha
export const CAPACITOR_PACKAGE_NAME = '@hotcodepush/capacitor-live-updates';
export const CAPACITOR_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/capacitor-live-updates/@hotcodepush/capacitor-live-updates@26759a9';
export const CLI_CLIENT_ID = 'hotcodepush-cli';
export const CORDOVA_PACKAGE_NAME = '@hotcodepush/cordova-code-push';
export const CORDOVA_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/cordova-code-push/@hotcodepush/cordova-code-push@aa5e2f5';
export const CLIENT_HEADER_NAME = 'X-HotCodePush-Client';
export const CONFIG_DIRECTORY_NAME = 'hotcodepush';
export const CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_API_URL = 'https://api.hotcodepush.com';
export const DOCS_URL = 'https://hotcodepush.com/docs';
export const BINARY_CREATE_HOOK_COMMAND = 'npx hotcodepush binary create';
export const BINARY_CREATE_HOOK_NAME = 'capacitor:copy:after';
export const ERRORS_DOCS_URL = 'https://hotcodepush.com/docs/cli/errors';
export const ISSUES_URL = 'https://github.com/hotcodepush-team/cli/issues';
export const KEYRING_ACCOUNT_NAME = 'token';
export const KEYRING_SERVICE_NAME = 'hotcodepush-cli';
export const PACKAGE_JSON: CliMeta = createRequire(import.meta.url)(
  '../../package.json',
);
export const PROJECT_CONFIG_FILE_NAME = 'hotcodepush.json';
export const REACT_NATIVE_PACKAGE_NAME = '@hotcodepush/react-native-code-push';
export const REACT_NATIVE_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/react-native-code-push/@hotcodepush/react-native-code-push@e8e3bc9';
export const SIGNING_KEY_DIRECTORY_NAME = 'keys';
