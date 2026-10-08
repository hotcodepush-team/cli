import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * What a Cordova project starts with in a test: the plugin when installed, its own `config.xml` and configuration.
 */
export interface CordovaProjectOptions {
  configXml?: string;
  isPluginInstalled?: boolean;
  projectConfig?: object;
}

export const CORDOVA_CONFIG_XML =
  '<?xml version="1.0" encoding="utf-8"?>\n<widget id="com.example.demo" version="2.4.1" xmlns="http://www.w3.org/ns/widgets">\n  <name>Demo</name>\n  <content src="index.html" />\n</widget>\n';

const CORDOVA_PACKAGES = { 'cordova': '13.0.0', 'cordova-android': '15.1.0' };

const PLUGIN_NAME = '@hotcodepush/cordova-code-push';

/**
 * A Cordova project in a temporary directory: `package.json` with the CLI and the Android platform, `config.xml`,
 * the web build in `www`, and the lockfile and installed packages the fingerprint reads; the caller removes it.
 */
export function writeCordovaProject({
  configXml = CORDOVA_CONFIG_XML,
  isPluginInstalled = false,
  projectConfig,
}: CordovaProjectOptions = {}): string {
  const directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-cordova-'));
  const devDependencies = {
    ...CORDOVA_PACKAGES,
    ...(isPluginInstalled ? { [PLUGIN_NAME]: '0.1.0' } : {}),
  };
  writeJson(join(directoryPath, 'package.json'), {
    cordova: {
      platforms: ['android'],
      ...(isPluginInstalled ? { plugins: { [PLUGIN_NAME]: {} } } : {}),
    },
    devDependencies,
    name: 'demo',
    scripts: { build: 'vite build' },
    version: '1.0.0',
  });
  writeJson(join(directoryPath, 'package-lock.json'), {
    lockfileVersion: 3,
    name: 'demo',
    packages: {
      '': { devDependencies, name: 'demo' },
      ...Object.fromEntries(
        Object.entries(devDependencies).map(([name, version]) => [
          `node_modules/${name}`,
          { dev: true, integrity: `sha512-${name}-invented==`, version },
        ]),
      ),
    },
  });
  for (const [name, version] of Object.entries(devDependencies)) {
    const packagePath = join(directoryPath, 'node_modules', name);
    mkdirSync(packagePath, { recursive: true });
    writeJson(join(packagePath, 'package.json'), { name, version });
  }
  writeFileSync(join(directoryPath, 'config.xml'), configXml);
  if (projectConfig !== undefined) {
    writeJson(join(directoryPath, 'hotcodepush.json'), projectConfig);
  }
  mkdirSync(join(directoryPath, 'www'));
  writeFileSync(join(directoryPath, 'www', 'index.html'), '<h1>v1</h1>');
  return directoryPath;
}

/**
 * The native glue a platform copy carries beside the web build, Capacitor's and Cordova's alike: Cordova's bridge,
 * its plugin list and a plugin's script, the files the binary serves under every bundle.
 */
export function writeNativeGlue(webDirectoryPath: string): void {
  for (const path of [
    'cordova.js',
    'cordova_plugins.js',
    'plugins/cordova-plugin-example/www/example.js',
  ]) {
    mkdirSync(dirname(join(webDirectoryPath, path)), { recursive: true });
    writeFileSync(join(webDirectoryPath, path), '// the binary serves this\n');
  }
}

function writeJson(filePath: string, value: object): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
