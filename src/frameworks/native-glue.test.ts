import { describe, expect, it } from 'vitest';
import { NATIVE_GLUE_PATHS, omitNativeGlue } from './native-glue.js';

describe('native glue', () => {
  it('should leave out the exact paths and everything under the plugins directory', () => {
    expect(
      omitNativeGlue(
        [
          { path: 'cordova.js' },
          { path: 'cordova_plugins.js' },
          { path: 'index.html' },
          { path: 'plugins/cordova-plugin-example/www/example.js' },
        ],
        NATIVE_GLUE_PATHS,
      ),
    ).toEqual([{ path: 'index.html' }]);
  });

  it('should keep the files that only resemble the glue', () => {
    const files = [
      { path: 'assets/cordova.js' },
      { path: 'cordova.json' },
      { path: 'plugins.js' },
      { path: 'vendor/plugins/example.js' },
    ];

    expect(omitNativeGlue(files, NATIVE_GLUE_PATHS)).toEqual(files);
  });
});
