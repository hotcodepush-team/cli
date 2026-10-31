import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { CliMeta } from '../utils/cli.js';

// The release build writes the telemetry keys. They are empty in every other build, so telemetry is off there.
interface CliPackageJson extends CliMeta {
  telemetry?: {
    posthogProjectKey?: string;
    sentryDsn?: string;
  };
}

// Each SDK is installed from the pkg.pr.new build of one commit until its package is published.
export const CAPACITOR_PACKAGE_NAME = '@hotcodepush/capacitor-live-updates';
export const CAPACITOR_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/capacitor-live-updates/@hotcodepush/capacitor-live-updates@a97c157';
export const CLI_CLIENT_ID = 'hotcodepush-cli';
export const CORDOVA_PACKAGE_NAME = '@hotcodepush/cordova-code-push';
export const CORDOVA_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/cordova-code-push/@hotcodepush/cordova-code-push@087f83e';
export const CLIENT_HEADER_NAME = 'X-HotCodePush-Client';
// The build writes the completion scripts to dist/completion, beside dist/config.
export const COMPLETION_DIRECTORY_PATH = fileURLToPath(
  new URL('../completion/', import.meta.url),
);
export const CONFIG_DIRECTORY_NAME = 'hotcodepush';
export const CONFIG_FILE_NAME = 'config.json';
export const DEFAULT_API_URL = 'https://api.hotcodepush.com';
export const DOCS_URL = 'https://hotcodepush.com/docs';
export const ERRORS_DOCS_URL = 'https://hotcodepush.com/docs/cli/errors';
export const EXPO_PACKAGE_NAME = '@hotcodepush/expo-ota-updates';
export const EXPO_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/expo-ota-updates/@hotcodepush/expo-ota-updates@0219169';
export const INIT_MANUAL_STEP = 'Run "hotcodepush init".';
export const ISSUES_URL = 'https://github.com/hotcodepush-team/cli/issues';
export const KEYRING_ACCOUNT_NAME = 'token';
export const KEYRING_SERVICE_NAME = 'hotcodepush-cli';
export const PACKAGE_JSON: CliPackageJson = createRequire(import.meta.url)(
  '../../package.json',
);
// Our reverse proxy to the PostHog EU host.
export const POSTHOG_HOST = 'https://hotcodepush.com/ingest';
export const POSTHOG_PROJECT_KEY =
  PACKAGE_JSON.telemetry?.posthogProjectKey ?? '';
export const PROJECT_CONFIG_FILE_NAME = 'hotcodepush.json';
export const REACT_NATIVE_PACKAGE_NAME = '@hotcodepush/react-native-code-push';
export const REACT_NATIVE_PACKAGE_SPEC =
  'https://pkg.pr.new/hotcodepush-team/react-native-code-push/@hotcodepush/react-native-code-push@56112dd';
export const SENTRY_DSN = PACKAGE_JSON.telemetry?.sentryDsn ?? '';
export const SIGNING_PRIVATE_KEY_FILE_NAME = 'hotcodepush-private-key.pem';
export const USER_AGENT = `hotcodepush-cli/${PACKAGE_JSON.version}`;
