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

// A run reads the terminal; a test passes the streams it drives.
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

// A prompt is one line, the symbol of its state and the question, with the answer after it once given, so it reads like the diagnostics around it.
export function confirm({
  initialValue,
  input,
  message,
  output,
}: ConfirmQuestion): Promise<boolean | symbol | undefined> {
  return new ConfirmPrompt({
    active: 'Yes',
    inactive: 'No',
    initialValue,
    input,
    output,
    render() {
      const answer = this.value ? 'Yes' : 'No';
      if (isAnswered(this.state)) {
        return resolveAnsweredLine(this.state, { answer, message });
      }
      const choices = [
        resolveChoiceText('Yes', { isActive: this.value === true }),
        resolveChoiceText('No', { isActive: this.value !== true }),
      ];
      return `${resolveQuestionLine(this.state, message)} ${choices.join(` ${style('dim', '/')} `)}`;
    },
  }).prompt();
}

export function password({
  input,
  message,
  output,
  validate,
}: InputQuestion): Promise<string | symbol | undefined> {
  return new PasswordPrompt({
    input,
    mask: S_PASSWORD_MASK,
    output,
    validate,
    render() {
      return resolveInputFrame(this.state, {
        answer: this.masked,
        error: this.error,
        input: this.userInputWithCursor,
        message,
      });
    },
  }).prompt();
}

export function select<TValue extends string>({
  input,
  message,
  options,
  output,
}: SelectQuestion<TValue>): Promise<TValue | symbol | undefined> {
  return new SelectPrompt({
    input,
    options,
    output,
    render() {
      const activeChoice = this.options[this.cursor];
      if (isAnswered(this.state)) {
        return resolveAnsweredLine(this.state, {
          answer: activeChoice?.label ?? '',
          message,
        });
      }
      const choiceLines = this.options.map(
        ({ label }, index) =>
          `${CONTINUATION_INDENT}${resolveChoiceText(label, { isActive: index === this.cursor })}`,
      );
      return [resolveQuestionLine(this.state, message), ...choiceLines].join(
        '\n',
      );
    },
  }).prompt();
}

export function text({
  input,
  message,
  output,
  validate,
}: InputQuestion): Promise<string | symbol | undefined> {
  return new TextPrompt({
    input,
    output,
    validate,
    render() {
      return resolveInputFrame(this.state, {
        answer: this.value ?? '',
        error: this.error,
        input: this.userInputWithCursor,
        message,
      });
    },
  }).prompt();
}

function isAnswered(state: State): boolean {
  return state === 'submit' || state === 'cancel';
}

// The answer is dimmed once given and struck through when the prompt was cancelled.
function resolveAnsweredLine(
  state: State,
  { answer, message }: { answer: string; message: string },
): string {
  const format: Format = state === 'cancel' ? ['strikethrough', 'dim'] : 'dim';
  return `${resolveQuestionLine(state, message)} ${style(format, answer)}`;
}

function resolveChoiceText(
  label: string,
  { isActive }: { isActive: boolean },
): string {
  return isActive
    ? `${style('green', S_RADIO_ACTIVE)} ${label}`
    : style('dim', `${S_RADIO_INACTIVE} ${label}`);
}

// The validation message takes the line below the input, the symbol marking the error.
function resolveInputFrame(
  state: State,
  { answer, error, input, message }: InputFrame,
): string {
  if (isAnswered(state)) {
    return resolveAnsweredLine(state, { answer, message });
  }
  const inputLine = `${resolveQuestionLine(state, message)} ${input}`;
  return state === 'error'
    ? `${inputLine}\n${CONTINUATION_INDENT}${style('yellow', error)}`
    : inputLine;
}

function resolveQuestionLine(state: State, message: string): string {
  return `${symbol(state)}  ${message}`;
}

function style(format: Format, text: string): string {
  return isColorEnabled(process.stdout)
    ? styleText(format, text, { validateStream: false })
    : text;
}
