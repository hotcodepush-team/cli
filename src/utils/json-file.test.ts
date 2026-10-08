import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExitCode } from './errors.js';
import { readJsonFile, stringifyLikeSource } from './json-file.js';

describe('json file', () => {
  let directoryPath = '';
  let filePath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-json-'));
    filePath = join(directoryPath, 'hotcodepush.json');
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  it('should read the value the file holds', () => {
    writeFileSync(filePath, '{ "channel": "staging" }');

    expect(readJsonFile(filePath)).toEqual({ channel: 'staging' });
  });

  it('should throw E_INVALID_JSON naming the file and where the parse stopped when the file does not parse', () => {
    writeFileSync(filePath, '{ "channel": "staging", }');

    expect(() => readJsonFile(filePath)).toThrow(
      expect.objectContaining({
        code: 'E_INVALID_JSON',
        exitCode: ExitCode.Error,
        message: expect.stringContaining(
          `${filePath} is no valid JSON: expected double-quoted property name in JSON at position 24`,
        ),
      }),
    );
  });

  it('should keep the text around an unexpected token out of the message', () => {
    writeFileSync(filePath, '{ "token": session-token-1 }');

    expect(() => readJsonFile(filePath)).toThrow(
      expect.objectContaining({
        message: `${filePath} is no valid JSON: unexpected token 's'`,
      }),
    );
  });

  it('should write JSON back with the indentation and the final newline of its source', () => {
    expect(stringifyLikeSource({ a: 1 }, '{\n    "b": 2\n}\n')).toBe(
      '{\n    "a": 1\n}\n',
    );
    expect(stringifyLikeSource({ a: 1 }, '{"b":2}')).toBe('{\n  "a": 1\n}');
  });
});
