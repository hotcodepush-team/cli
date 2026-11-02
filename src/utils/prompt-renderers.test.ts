import { PassThrough } from 'node:stream';
import { setTimeout } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import { isCancel } from '@clack/core';
import {
  S_PASSWORD_MASK,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  S_STEP_ACTIVE,
  S_STEP_CANCEL,
  S_STEP_ERROR,
  S_STEP_SUBMIT,
} from '@clack/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm, password, select, text } from './prompt-renderers.js';

const CONTROL_C_KEY = '\x03';
const RETURN_KEY = '\r';
const DOWN_KEY = '\x1b[B';

// Each frame clack writes, control sequences stripped, so a test reads what the terminal would show.
function createTerminal({ rows }: { rows?: number } = {}) {
  const input = new PassThrough();
  const output = Object.assign(new PassThrough(), { rows });
  const frames: string[] = [];
  output.on('data', (chunk: Buffer) => {
    const frame = stripVTControlCharacters(chunk.toString()).trim();
    if (frame) {
      frames.push(frame);
    }
  });
  return {
    frames,
    input,
    output,
    lastFrame: () => frames.at(-1),
    async type(keys: string) {
      await setTimeout(10);
      input.write(keys);
    },
  };
}

beforeEach(() => {
  vi.stubEnv('NO_COLOR', '1');
});

describe('confirm', () => {
  it('should draw the question and both choices on one line while open', async () => {
    const terminal = createTerminal();

    const answer = confirm({
      ...terminal,
      initialValue: true,
      message: 'Log in now?',
    });
    await terminal.type(RETURN_KEY);
    await answer;

    expect(terminal.frames[0]).toBe(
      `${S_STEP_ACTIVE}  Log in now? ${S_RADIO_ACTIVE} Yes / ${S_RADIO_INACTIVE} No`,
    );
  });

  it('should keep the answer on the question line once submitted', async () => {
    const terminal = createTerminal();

    const answer = confirm({
      ...terminal,
      initialValue: false,
      message: 'Log in now?',
    });
    await terminal.type(RETURN_KEY);

    expect(await answer).toBe(false);
    expect(terminal.lastFrame()).toBe(`${S_STEP_SUBMIT}  Log in now? No`);
  });

  it('should mark the line cancelled when the prompt is left', async () => {
    const terminal = createTerminal();

    const answer = confirm({
      ...terminal,
      initialValue: true,
      message: 'Log in now?',
    });
    await terminal.type(CONTROL_C_KEY);

    expect(isCancel(await answer)).toBe(true);
    expect(terminal.lastFrame()).toBe(`${S_STEP_CANCEL}  Log in now? Yes`);
  });
});

describe('select', () => {
  it('should list the choices under the question and keep the chosen one on its line', async () => {
    const terminal = createTerminal();

    const answer = select({
      ...terminal,
      message: 'Which framework?',
      options: [
        { label: 'Capacitor', value: 'capacitor' },
        { label: 'Expo', value: 'expo' },
      ],
    });
    await terminal.type(DOWN_KEY);
    await terminal.type(RETURN_KEY);

    expect(await answer).toBe('expo');
    expect(terminal.frames[0]).toBe(
      [
        `${S_STEP_ACTIVE}  Which framework?`,
        `   ${S_RADIO_ACTIVE} Capacitor`,
        `   ${S_RADIO_INACTIVE} Expo`,
      ].join('\n'),
    );
    expect(terminal.lastFrame()).toBe(
      `${S_STEP_SUBMIT}  Which framework? Expo`,
    );
  });

  it('should show a window of the choices with an ellipsis when the terminal has fewer rows', async () => {
    const terminal = createTerminal({ rows: 9 });

    const answer = select({
      ...terminal,
      message: 'Which bundle?',
      options: Array.from({ length: 12 }, (_, index) => ({
        label: `#${12 - index}`,
        value: `bundle-${index}`,
      })),
    });
    await terminal.type(RETURN_KEY);
    await answer;

    expect(terminal.frames[0]).toBe(
      [
        `${S_STEP_ACTIVE}  Which bundle?`,
        `   ${S_RADIO_ACTIVE} #12`,
        `   ${S_RADIO_INACTIVE} #11`,
        `   ${S_RADIO_INACTIVE} #10`,
        `   ${S_RADIO_INACTIVE} #9`,
        '   ...',
      ].join('\n'),
    );
  });
});

describe('text', () => {
  it('should keep the typed value on the question line once submitted', async () => {
    const terminal = createTerminal();

    const answer = text({
      ...terminal,
      message: 'What is the channel called?',
      validate: () => undefined,
    });
    await terminal.type('production');
    await terminal.type(RETURN_KEY);

    expect(await answer).toBe('production');
    expect(terminal.lastFrame()).toBe(
      `${S_STEP_SUBMIT}  What is the channel called? production`,
    );
  });

  it('should put the validation message under the input when the value is refused', async () => {
    const terminal = createTerminal();

    const answer = text({
      ...terminal,
      message: 'What is the channel called?',
      validate: value => (value ? undefined : 'Enter a value.'),
    });
    await terminal.type(RETURN_KEY);

    expect(terminal.lastFrame()).toBe(
      [
        `${S_STEP_ERROR}  What is the channel called? █`,
        '   Enter a value.',
      ].join('\n'),
    );
    await terminal.type('production');
    await terminal.type(RETURN_KEY);
    expect(await answer).toBe('production');
  });
});

describe('password', () => {
  it('should show the mask and never the secret in any frame', async () => {
    const terminal = createTerminal();

    const answer = password({
      ...terminal,
      message: 'Token?',
      validate: value => (value === 'ab' ? 'Too short.' : undefined),
    });
    await terminal.type('ab');
    await terminal.type(RETURN_KEY);
    await terminal.type('c');
    await terminal.type(RETURN_KEY);

    expect(await answer).toBe('abc');
    expect(terminal.frames.join('\n')).not.toContain('ab');
    expect(terminal.lastFrame()).toBe(
      `${S_STEP_SUBMIT}  Token? ${S_PASSWORD_MASK.repeat(3)}`,
    );
  });
});
