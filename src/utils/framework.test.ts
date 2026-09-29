import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingParameterError } from './errors.js';
import { resolveInputDirectoryPath } from './framework.js';

describe('framework', () => {
  let projectDirectoryPath = '';

  beforeEach(() => {
    projectDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-fw-'));
    vi.spyOn(process, 'cwd').mockReturnValue(join(projectDirectoryPath, 'sub'));
  });

  afterEach(() => {
    rmSync(projectDirectoryPath, { force: true, recursive: true });
  });

  it('should keep an absolute --path and resolve a relative one against the working directory', async () => {
    expect(
      await resolveInputDirectoryPath(
        { path: '/abs/dist' },
        { dir: 'www' },
        projectDirectoryPath,
      ),
    ).toBe(resolve('/abs/dist'));
    expect(
      await resolveInputDirectoryPath(
        { path: '../dist' },
        { dir: 'www' },
        projectDirectoryPath,
      ),
    ).toBe(join(projectDirectoryPath, 'dist'));
  });

  it("should resolve hotcodepush.json's dir and Capacitor's webDir against the project root", async () => {
    expect(
      await resolveInputDirectoryPath({}, { dir: 'www' }, projectDirectoryPath),
    ).toBe(join(projectDirectoryPath, 'www'));
    writeFileSync(
      join(projectDirectoryPath, 'capacitor.config.json'),
      JSON.stringify({ webDir: 'build' }),
    );
    expect(
      await resolveInputDirectoryPath({}, undefined, projectDirectoryPath),
    ).toBe(join(projectDirectoryPath, 'build'));
  });

  it('should ask for --path when nothing names the build, and name the flag when nobody can be asked', async () => {
    await expect(
      resolveInputDirectoryPath(
        { json: true },
        undefined,
        projectDirectoryPath,
      ),
    ).rejects.toBeInstanceOf(MissingParameterError);
  });
});
