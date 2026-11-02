import type { Readable, Writable } from 'node:stream';
import { styleText } from 'node:util';
import type { State } from '@clack/core';
import {
  ConfirmPrompt,
  PasswordPrompt,
  SelectPrompt,
  TextPrompt,
} from '@clack/core';
import {
  limitOptions,
  S_PASSWORD_MASK,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
} from '@clack/prompts';
import { isColorEnabled } from './environment.js';

export interface Choice<TValue extends string> {
  label: string;
  value: TValue;
}

// A run reads the terminal and answers on stderr, so stdout stays the result; a test passes the streams it drives.
interface Question {
  input?: Readable;
  message: string;
  output?: Writable;
}

interface ConfirmQuestion extends Question {
  initialValue: boolean;
}

interface InputQuestion extends Question {
  validate: (value: string | undefined) => string | undefined;
}

interface SelectQuestion<TValue extends string> extends Question {
  options: Choice<TValue>[];
}

interface InputFrame {
  answer: string;
  error: string;
  input: string;
  message: string;
}

type Format = Parameters<typeof styleText>[0];

const CONTINUATION_INDENT = '   ';
const NO = 'No';
const YES = 'Yes';

export function confirm({
  initialValue,
  input,
  message,
  output = process.stderr,
}: ConfirmQuestion): Promise<boolean | symbol | undefined> {
  return new ConfirmPrompt({
    active: YES,
    inactive: NO,
    initialValue,
    input,
    output,
    render() {
      const answer = this.value ? YES : NO;
      if (isSettled(this.state)) {
        return resolveSettledLine(this.state, { answer, message });
      }
      const choices = [
        resolveChoiceText(YES, { isActive: this.value === true }),
        resolveChoiceText(NO, { isActive: this.value !== true }),
      ];
      return `${resolveQuestionLine(this.state, { message })} ${choices.join(` ${styleStderr('dim', '/')} `)}`;
    },
  }).prompt();
}

export function password({
  input,
  message,
  output = process.stderr,
  validate,
}: InputQuestion): Promise<string | symbol | undefined> {
  return new PasswordPrompt({
    input,
    mask: S_PASSWORD_MASK,
    output,
    render() {
      return resolveInputFrame(this.state, {
        answer: this.masked,
        error: this.error,
        input: this.userInputWithCursor,
        message,
      });
    },
    validate,
  }).prompt();
}

// The choices are the window clack fits into the terminal's rows, scrolled with the cursor and cut with a dimmed ellipsis.
export function select<TValue extends string>({
  input,
  message,
  options,
  output = process.stderr,
}: SelectQuestion<TValue>): Promise<TValue | symbol | undefined> {
  return new SelectPrompt({
    input,
    options,
    output,
    render() {
      if (isSettled(this.state)) {
        return resolveSettledLine(this.state, {
          answer: this.options[this.cursor]?.label ?? '',
          message,
        });
      }
      const choiceLines = limitOptions({
        cursor: this.cursor,
        options: this.options,
        output,
        style: ({ label }, isActive) => resolveChoiceText(label, { isActive }),
      }).map(line => `${CONTINUATION_INDENT}${line}`);
      return [
        resolveQuestionLine(this.state, { message }),
        ...choiceLines,
      ].join('\n');
    },
  }).prompt();
}

export function text({
  input,
  message,
  output = process.stderr,
  validate,
}: InputQuestion): Promise<string | symbol | undefined> {
  return new TextPrompt({
    input,
    output,
    render() {
      return resolveInputFrame(this.state, {
        answer: this.value ?? '',
        error: this.error,
        input: this.userInputWithCursor,
        message,
      });
    },
    validate,
  }).prompt();
}

function isSettled(state: State): boolean {
  return state === 'submit' || state === 'cancel';
}

function resolveChoiceText(
  label: string,
  { isActive }: { isActive: boolean },
): string {
  return isActive
    ? `${styleStderr('green', S_RADIO_ACTIVE)} ${label}`
    : styleStderr('dim', `${S_RADIO_INACTIVE} ${label}`);
}

function resolveInputFrame(
  state: State,
  { answer, error, input, message }: InputFrame,
): string {
  if (isSettled(state)) {
    return resolveSettledLine(state, { answer, message });
  }
  const inputLine = `${resolveQuestionLine(state, { message })} ${input}`;
  return state === 'error'
    ? `${inputLine}\n${CONTINUATION_INDENT}${styleStderr('yellow', error)}`
    : inputLine;
}

function resolveQuestionLine(
  state: State,
  { message }: { message: string },
): string {
  return `${symbol(state)}  ${message}`;
}

function resolveSettledLine(
  state: State,
  { answer, message }: { answer: string; message: string },
): string {
  const format: Format = state === 'cancel' ? ['strikethrough', 'dim'] : 'dim';
  return `${resolveQuestionLine(state, { message })} ${styleStderr(format, answer)}`;
}

function styleStderr(format: Format, text: string): string {
  return isColorEnabled(process.stderr)
    ? styleText(format, text, { validateStream: false })
    : text;
}
