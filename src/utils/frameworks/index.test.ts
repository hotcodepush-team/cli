import { describe, expect, it } from 'vitest';
import { UnsupportedFrameworkError } from '../errors.js';
import { resolveFrameworkModule } from './index.js';

describe('frameworks', () => {
  it('should answer the module of a framework the CLI packages', () => {
    expect(resolveFrameworkModule('capacitor').packageName).toBe(
      '@hotcodepush/capacitor-live-updates',
    );
    expect(resolveFrameworkModule('cordova').packageName).toBe(
      '@hotcodepush/cordova-code-push',
    );
  });

  it('should refuse a framework whose packaging has not arrived', () => {
    expect(() => resolveFrameworkModule('expo')).toThrow(
      new UnsupportedFrameworkError('expo'),
    );
  });
});
