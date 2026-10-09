import { createRequire } from 'node:module';
import type { CliMeta } from '../utils/cli.js';

// An SDK is installed from the pkg.pr.new build of one commit until its package is published; a bump is one edit of the sha
export const CAPACITOR_PACKAGE_NAME = '@hotcodepush/capacitor-live-updates';
export const CAPACITOR_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/capacitor-live-updates/@hotcodepush/capacitor-live-updates@af620e9';
export const CLI_CLIENT_ID = 'hotcodepush-cli';
export const CORDOVA_PACKAGE_NAME = '@hotcodepush/cordova-code-push';
export const CORDOVA_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/cordova-code-push/@hotcodepush/cordova-code-push@56a341a';
export const CLIENT_HEADER_NAME = 'X-HotCodePush-Client';
export const CONFIG_DIRECTORY_NAME = 'hotcodepush';
export const CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_API_URL = 'https://api.hotcodepush.com';
export const DOCS_URL = 'https://hotcodepush.com/docs';
export const ERRORS_DOCS_URL = 'https://hotcodepush.com/docs/cli/errors';
export const EXPO_PACKAGE_NAME = '@hotcodepush/expo-ota-updates';
export const EXPO_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/expo-ota-updates/@hotcodepush/expo-ota-updates@7dace73';
export const INIT_MANUAL_STEP = 'run hotcodepush init';
export const ISSUES_URL = 'https://github.com/hotcodepush-team/cli/issues';
export const KEYRING_ACCOUNT_NAME = 'token';
export const KEYRING_SERVICE_NAME = 'hotcodepush-cli';
export const PACKAGE_JSON: CliMeta = createRequire(import.meta.url)(
  '../../package.json',
);
export const PROJECT_CONFIG_FILE_NAME = 'hotcodepush.json';
export const REACT_NATIVE_PACKAGE_NAME = '@hotcodepush/react-native-code-push';
export const REACT_NATIVE_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/react-native-code-push/@hotcodepush/react-native-code-push@f7512fe';
export const SIGNING_PRIVATE_KEY_FILE_NAME = 'hotcodepush-private-key.pem';
export const USER_AGENT = `hotcodepush-cli/${PACKAGE_JSON.version}`;
