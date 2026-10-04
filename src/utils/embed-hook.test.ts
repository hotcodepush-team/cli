import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeCapacitorProject } from '../../test/capacitor-project.js';
import {
  resolveEmbedHookState,
  stringifyLikeSource,
  wireEmbedHook,
} from './embed-hook.js';
import { HookOccupiedError } from './errors.js';

describe('embed-hook', () => {
  const directoryPaths: string[] = [];

  function writeProject(hookScript?: string): string {
    const directoryPath = writeCapacitorProject({ hookScript });
    directoryPaths.push(directoryPath);
    return directoryPath;
  }

  function readScripts(directoryPath: string): Record<string, string> {
    return (
      JSON.parse(readFileSync(join(directoryPath, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
  }

  afterEach(() => {
    for (const directoryPath of directoryPaths.splice(0)) {
      rmSync(directoryPath, { force: true, recursive: true });
    }
  });

  it('should tell the states apart: absent, occupied by a command, wired, and a script it cannot parse', () => {
    expect(resolveEmbedHookState({})).toBe('absent');
    expect(
      resolveEmbedHookState({
        scripts: { 'capacitor:copy:after': 'node x.mjs' },
      }),
    ).toBe('occupied');
    expect(
      resolveEmbedHookState({
        scripts: {
          'capacitor:copy:after': 'node x.mjs && npx hotcodepush binary create',
        },
      }),
    ).toBe('wired');
    expect(
      resolveEmbedHookState({ scripts: { 'capacitor:copy:after': 'a; b' } }),
    ).toBe('unparseable');
    expect(
      resolveEmbedHookState({ scripts: { 'capacitor:copy:after': 'a || b' } }),
    ).toBe('unparseable');
  });

  it('should take a script still running bundle embed as occupied, since only binary create is the step', () => {
    expect(
      resolveEmbedHookState({
        scripts: { 'capacitor:copy:after': 'npx hotcodepush bundle embed' },
      }),
    ).toBe('occupied');
  });

  it('should set the script when there is none, keeping the indentation and the final newline', () => {
    const directoryPath = writeProject();

    expect(wireEmbedHook(directoryPath)).toBe('wired');

    expect(readScripts(directoryPath)['capacitor:copy:after']).toBe(
      'npx hotcodepush binary create',
    );
    expect(readFileSync(join(directoryPath, 'package.json'), 'utf8')).toMatch(
      /^\{\n {2}"dependencies"[\s\S]*\}\n$/,
    );
  });

  it('should append the command to an existing one and leave a wired script alone', () => {
    const directoryPath = writeProject('node scripts/write.mjs');

    expect(wireEmbedHook(directoryPath)).toBe('wired');
    expect(wireEmbedHook(directoryPath)).toBe('present');

    expect(readScripts(directoryPath)['capacitor:copy:after']).toBe(
      'node scripts/write.mjs && npx hotcodepush binary create',
    );
  });

  it('should refuse a script it cannot parse with E_HOOK_OCCUPIED', () => {
    const directoryPath = writeProject('a; b');

    expect(() => wireEmbedHook(directoryPath)).toThrow(HookOccupiedError);
  });

  it('should write JSON the way the source was written', () => {
    expect(stringifyLikeSource({ a: 1 }, '{\n    "b": 2\n}\n')).toBe(
      '{\n    "a": 1\n}\n',
    );
    expect(stringifyLikeSource({ a: 1 }, '{"b":2}')).toBe('{\n  "a": 1\n}');
  });

  it('should keep the other scripts and fields', () => {
    const directoryPath = writeProject();
    writeFileSync(
      join(directoryPath, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { build: 'b' }, version: '1' }),
    );

    wireEmbedHook(directoryPath);

    expect(
      JSON.parse(readFileSync(join(directoryPath, 'package.json'), 'utf8')),
    ).toEqual({
      name: 'x',
      scripts: {
        'build': 'b',
        'capacitor:copy:after': 'npx hotcodepush binary create',
      },
      version: '1',
    });
  });
});
