import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { ConfirmationRequiredError, MissingParameterError } from './errors.js';
import type { Choice } from './prompt-renderers.js';
import { confirm, password, select, text } from './prompt-renderers.js';

interface InputPrompt {
  flag: string;
  message: string;
}

interface SelectPrompt<TValue extends string> extends InputPrompt {
  choices: Choice<TValue>[];
}

export async function confirmConsequence(
  consequence: string,
  options: InteractivityOptions,
): Promise<boolean> {
  if (options.yes) {
    return true;
  }
  if (!isInteractive(options)) {
    throw new ConfirmationRequiredError(consequence);
  }
  const answer = await confirm({
    initialValue: false,
    message: `This ${consequence}. Continue?`,
  });
  return answer === true;
}

export async function promptYesNo(
  message: string,
  options: InteractivityOptions,
): Promise<boolean> {
  if (!isInteractive(options)) {
    return false;
  }
  const answer = await confirm({ initialValue: true, message });
  return answer === true;
}

export async function promptSelect<TValue extends string>(
  options: InteractivityOptions,
  { choices, flag, message }: SelectPrompt<TValue>,
): Promise<TValue> {
  if (choices.length === 0 || !isInteractive(options)) {
    throw new MissingParameterError(flag);
  }
  const answer = await select({ message, options: choices });
  if (typeof answer !== 'string') {
    throw new MissingParameterError(flag);
  }
  return answer;
}

export function promptSecret(
  options: InteractivityOptions,
  prompt: InputPrompt,
): Promise<string> {
  return promptInput(options, { ...prompt, ask: password });
}

export function promptText(
  options: InteractivityOptions,
  prompt: InputPrompt,
): Promise<string> {
  return promptInput(options, { ...prompt, ask: text });
}

async function promptInput(
  options: InteractivityOptions,
  { ask, flag, message }: InputPrompt & { ask: typeof password | typeof text },
): Promise<string> {
  if (!isInteractive(options)) {
    throw new MissingParameterError(flag);
  }
  const answer = await ask({
    message,
    validate: value => (value?.trim() ? undefined : 'Enter a value.'),
  });
  if (typeof answer !== 'string') {
    throw new MissingParameterError(flag);
  }
  return answer;
}
