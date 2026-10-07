import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingParameterError } from './errors.js';
import { detectFramework, resolveInputDirectoryPath } from './framework.js';
import { resolveFrameworkModule } from './frameworks/index.js';

const CAPACITOR = resolveFrameworkModule('capacitor');

describe('framework', () => {
  let projectDirectoryPath = '';

  beforeEach(() => {
    projectDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-fw-'));
    vi.spyOn(process, 'cwd').mockReturnValue(join(projectDirectoryPath, 'sub'));
  });

  afterEach(() => {
    rmSync(projectDirectoryPath, { force: true, recursive: true });
  });

  function writePackageJson(dependencies: Record<string, string>): void {
    writeFileSync(
      join(projectDirectoryPath, 'package.json'),
      JSON.stringify({ dependencies }),
    );
  }

  it('should throw E_INVALID_JSON naming package.json when it does not parse', () => {
    const packageJsonPath = join(projectDirectoryPath, 'package.json');
    writeFileSync(packageJsonPath, '{ "dependencies": ');

    expect(() => detectFramework(projectDirectoryPath)).toThrow(
      expect.objectContaining({
        code: 'E_INVALID_JSON',
        message: `${packageJsonPath} is no valid JSON: unexpected end of JSON input`,
      }),
    );
  });

  it('should take the framework whose config file the project has when package.json names several', () => {
    writePackageJson({ '@capacitor/core': '8.0.0', 'cordova': '12.0.0' });
    writeFileSync(join(projectDirectoryPath, 'config.xml'), '<widget />');

    expect(detectFramework(projectDirectoryPath)).toBe('cordova');
  });

  it('should take an app.json carrying the expo key as the config file that breaks the tie', () => {
    writePackageJson({ '@capacitor/core': '8.0.0', 'expo': '54.0.0' });
    writeFileSync(
      join(projectDirectoryPath, 'app.json'),
      JSON.stringify({ expo: { name: 'Demo' } }),
    );

    expect(detectFramework(projectDirectoryPath)).toBe('expo');
  });

  it('should keep the first framework named when no config file breaks the tie', () => {
    writePackageJson({ '@capacitor/core': '8.0.0', 'cordova': '12.0.0' });

    expect(detectFramework(projectDirectoryPath)).toBe('capacitor');
  });

  it('should keep an absolute --path and resolve a relative one against the working directory', async () => {
    expect(
      await resolveInputDirectoryPath(
        { path: '/abs/dist' },
        { dir: 'www' },
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).toBe(resolve('/abs/dist'));
    expect(
      await resolveInputDirectoryPath(
        { path: '../dist' },
        { dir: 'www' },
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).toBe(join(projectDirectoryPath, 'dist'));
  });

  it("should resolve hotcodepush.json's dir and Capacitor's webDir against the project root", async () => {
    expect(
      await resolveInputDirectoryPath(
        {},
        { dir: 'www' },
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).toBe(join(projectDirectoryPath, 'www'));
    writeFileSync(
      join(projectDirectoryPath, 'capacitor.config.json'),
      JSON.stringify({ webDir: 'build' }),
    );
    expect(
      await resolveInputDirectoryPath(
        {},
        undefined,
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).toBe(join(projectDirectoryPath, 'build'));
  });

  it('should ask for --path when nothing names the build, and name the flag when nobody can be asked', async () => {
    await expect(
      resolveInputDirectoryPath(
        { json: true },
        undefined,
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).rejects.toBeInstanceOf(MissingParameterError);
  });
});
