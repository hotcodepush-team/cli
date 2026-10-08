/**
 * The native glue a platform copy of the web build carries beside it — Cordova's bridge, its plugin list and the plugins'
 * scripts, which Capacitor copies too — and which the binary serves under every bundle, so neither the embedded manifest
 * nor a release lists it. A path ending in `/` names everything under it.
 */
export const NATIVE_GLUE_PATHS: readonly string[] = [
  'cordova.js',
  'cordova_plugins.js',
  'plugins/',
];

/**
 * The files without the native glue the paths name: each exact path, and every file under a path ending in `/`.
 */
export function omitNativeGlue<TFile extends { path: string }>(
  files: TFile[],
  nativeGluePaths: readonly string[],
): TFile[] {
  return files.filter(
    ({ path }) =>
      !nativeGluePaths.some(gluePath =>
        gluePath.endsWith('/') ? path.startsWith(gluePath) : path === gluePath,
      ),
  );
}
