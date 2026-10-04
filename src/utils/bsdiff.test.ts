import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyBsdiffPatch, writeBsdiffPatch } from './bsdiff.js';

// A script of 2,000 lines and the same with one line changed
const FROM_SCRIPT = Buffer.from(
  Array.from({ length: 2000 }, (_, line) => `console.log(${line});\n`).join(''),
);
const TO_SCRIPT = Buffer.from(
  FROM_SCRIPT.toString().replace('console.log(1000);', 'console.log("v2");'),
);

describe('writeBsdiffPatch', () => {
  let temporaryDirectoryPath = '';

  beforeEach(() => {
    temporaryDirectoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-bsdiff-'));
  });

  afterEach(() => {
    rmSync(temporaryDirectoryPath, { force: true, recursive: true });
  });

  it('should write a BSDIFF40 patch that turns the first file into the second', async () => {
    const fromFilePath = join(temporaryDirectoryPath, 'from.js');
    const toFilePath = join(temporaryDirectoryPath, 'to.js');
    const patchFilePath = join(temporaryDirectoryPath, 'to.patch');
    writeFileSync(fromFilePath, FROM_SCRIPT);
    writeFileSync(toFilePath, TO_SCRIPT);

    await writeBsdiffPatch(fromFilePath, toFilePath, patchFilePath);

    const patchBytes = readFileSync(patchFilePath);
    expect(patchBytes.subarray(0, 8).toString()).toBe('BSDIFF40');
    expect(patchBytes.length).toBeLessThan(TO_SCRIPT.length / 10);
    expect(applyBsdiffPatch(FROM_SCRIPT, patchBytes)).toEqual(
      new Uint8Array(TO_SCRIPT),
    );
  });
});
