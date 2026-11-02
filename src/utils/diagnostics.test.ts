import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDiagnosticText } from '../../test/diagnostics.js';
import { printBlockEnd, printError, printNotice } from './diagnostics.js';

const DOCS_URL = 'https://hotcodepush.com/docs/cli/errors#invalid_parameter';

const originalStderrIsTty = process.stderr.isTTY;

function captureOutput() {
  const stderrWrite = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const stdoutWrite = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  return {
    readStderr: () =>
      stderrWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
    readStdout: () =>
      stdoutWrite.mock.calls.map(([chunk]) => String(chunk)).join(''),
  };
}

describe('printError', () => {
  afterEach(() => {
    process.stderr.isTTY = originalStderrIsTty;
  });

  it('should put the sentences and the docs URL on stderr as three plain lines and nothing on stdout when stderr is no terminal', () => {
    process.stderr.isTTY = false;
    const output = captureOutput();

    printError({
      docsUrl: DOCS_URL,
      sentences: ['The value is invalid.', 'Pass a valid value.'],
    });

    expect(output.readStderr()).not.toContain('\x1b[');
    expect(resolveDiagnosticText(output.readStderr())).toBe(
      `The value is invalid.\nPass a valid value.\n${DOCS_URL}\n`,
    );
    expect(output.readStdout()).toBe('');
  });

  it('should dim the docs URL when stderr is a terminal and NO_COLOR is unset', () => {
    process.stderr.isTTY = true;
    vi.stubEnv('NO_COLOR', undefined);
    vi.stubEnv('TERM', 'xterm-256color');
    const output = captureOutput();

    printError({ docsUrl: DOCS_URL, sentences: ['The value is invalid.'] });

    expect(output.readStderr()).toContain(`\x1b[2m${DOCS_URL}`);
  });
});

describe('printNotice', () => {
  afterEach(() => {
    process.stderr.isTTY = originalStderrIsTty;
  });

  it('should put the symbol before the first line and indent the lines under it, with no gutter line around them', () => {
    process.stderr.isTTY = false;
    const output = captureOutput();

    printNotice(
      'Open the page and approve the code.\nWaiting for the approval…',
    );

    expect(output.readStderr()).toMatch(
      /^\S+ {2}Open the page and approve the code\.\n {3}Waiting for the approval…\n$/,
    );
  });
});

describe('printBlockEnd', () => {
  afterEach(() => {
    process.stderr.isTTY = originalStderrIsTty;
  });

  it('should write one blank line when stderr is a terminal', () => {
    process.stderr.isTTY = true;
    const output = captureOutput();

    printBlockEnd();

    expect(output.readStderr()).toBe('\n');
  });

  it('should write nothing when stderr is no terminal', () => {
    process.stderr.isTTY = false;
    const output = captureOutput();

    printBlockEnd();

    expect(output.readStderr()).toBe('');
  });
});
