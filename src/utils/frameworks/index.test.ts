import { describe, expect, it } from 'vitest';
import { resolveFrameworkModule } from './index.js';

describe('frameworks', () => {
  it('should answer the module of a framework the CLI packages', () => {
    expect(resolveFrameworkModule('capacitor').packageName).toBe(
      '@hotcodepush/capacitor-live-updates',
    );
    expect(resolveFrameworkModule('cordova').packageName).toBe(
      '@hotcodepush/cordova-code-push',
    );
    expect(resolveFrameworkModule('expo').packageName).toBe(
      '@hotcodepush/expo-ota-updates',
    );
  });
});
