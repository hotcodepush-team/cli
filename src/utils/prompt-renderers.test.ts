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
function createTerminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  const frames: string[] = [];
  output.on('data', (chunk: Buffer) => {
    const frame = stripVTControlCharacters(chunk.toString()).trim();
    if (frame) {
      frames.push(frame);
    }
  });
  return {
    input,
    output,
    lastFrame: () => frames.at(-1),
    async type(keys: string) {
      await setTimeout(10);
      input.write(keys);
    },
  };
}

describe('confirm', () => {
  beforeEach(() => {
    vi.stubEnv('NO_COLOR', '1');
  });

  it('should draw the question and both choices on one line while open', async () => {
    const terminal = createTerminal();

    const answer = confirm({
      ...terminal,
      initialValue: true,
      message: 'Log in now?',
    });
    await terminal.type(RETURN_KEY);
    await answer;

    expect(terminal.lastFrame()).toBe(`${S_STEP_SUBMIT}  Log in now? Yes`);
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
  beforeEach(() => {
    vi.stubEnv('NO_COLOR', '1');
  });

  it('should list the choices under the question and keep the chosen one on its line', async () => {
    const terminal = createTerminal();
    const frames: string[] = [];
    terminal.output.on('data', () => {
      const frame = terminal.lastFrame();
      if (frame !== undefined) {
        frames.push(frame);
      }
    });

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
    expect(frames[0]).toBe(
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
});

describe('text', () => {
  beforeEach(() => {
    vi.stubEnv('NO_COLOR', '1');
  });

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
        `${S_STEP_ERROR}  What is the channel called? \u2588`,
        '   Enter a value.',
      ].join('\n'),
    );
    await terminal.type('production');
    await terminal.type(RETURN_KEY);
    expect(await answer).toBe('production');
  });
});

describe('password', () => {
  beforeEach(() => {
    vi.stubEnv('NO_COLOR', '1');
  });

  it('should show the mask and never the secret, once submitted too', async () => {
    const terminal = createTerminal();

    const answer = password({
      ...terminal,
      message: 'Token?',
      validate: () => undefined,
    });
    await terminal.type('abc');
    await terminal.type(RETURN_KEY);

    expect(await answer).toBe('abc');
    expect(terminal.lastFrame()).toBe(
      `${S_STEP_SUBMIT}  Token? ${S_PASSWORD_MASK.repeat(3)}`,
    );
  });
});
