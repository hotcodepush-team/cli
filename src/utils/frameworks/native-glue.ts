// Cordova's bridge and plugin scripts, which Capacitor copies too. The binary serves them under every bundle.
// A path ending in `/` names everything under it.
export const NATIVE_GLUE_PATHS: readonly string[] = [
  'cordova.js',
  'cordova_plugins.js',
  'plugins/',
];

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
