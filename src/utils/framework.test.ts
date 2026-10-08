import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        '--path',
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).toBe(resolve('/abs/dist'));
    expect(
      await resolveInputDirectoryPath(
        { path: '../dist' },
        '--path',
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).toBe(join(projectDirectoryPath, 'dist'));
  });

  it("should resolve Capacitor's webDir against the project root when the upload runs", async () => {
    writeFileSync(
      join(projectDirectoryPath, 'capacitor.config.json'),
      JSON.stringify({ webDir: 'build' }),
    );

    expect(
      await resolveInputDirectoryPath(
        {},
        '--path',
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).toBe(join(projectDirectoryPath, 'build'));
  });

  it("should resolve Cordova's www against the project root", async () => {
    expect(
      await resolveInputDirectoryPath(
        {},
        '--path',
        projectDirectoryPath,
        resolveFrameworkModule('cordova'),
      ),
    ).toBe(join(projectDirectoryPath, 'www'));
  });

  it('should require --path with the reason when there is no capacitor.config and nobody can be asked', async () => {
    await expect(
      resolveInputDirectoryPath(
        { json: true },
        '--path',
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      fix: 'pass --path, since there is no capacitor.config.json or capacitor.config.ts to read webDir from.',
      message: '--path is missing',
    });
  });

  it('should require --path with the reason when capacitor.config sets webDir in a way the CLI cannot read', async () => {
    writeFileSync(
      join(projectDirectoryPath, 'capacitor.config.ts'),
      'const config = { appId: "com.example.demo", webDir: process.env.WEB_DIR };\nexport default config;\n',
    );

    await expect(
      resolveInputDirectoryPath(
        { json: true },
        '--path',
        projectDirectoryPath,
        CAPACITOR,
      ),
    ).rejects.toMatchObject({
      code: 'E_MISSING_PARAMETER',
      fix: 'pass --path, since capacitor.config.ts sets no webDir the CLI can read as a quoted string.',
    });
  });
});
