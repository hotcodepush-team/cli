import { confirm, isCancel, password, select, text } from '@clack/prompts';
import type { InteractivityOptions } from './environment.js';
import { isInteractive } from './environment.js';
import { ConfirmationRequiredError, MissingParameterError } from './errors.js';

export interface Choice<TValue extends string> {
  label: string;
  value: TValue;
}

/**
 * Asks once before a command changes what devices receive or cannot be undone, stating the consequence.
 * `--yes` answers for the person; without a person to ask, the command stops with `E_CONFIRMATION_REQUIRED`.
 */
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

/**
 * A yes-or-no question only a person answers — "publish a first release now?" — that is no when nobody is there.
 */
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

/**
 * A required parameter the command line left out, picked from its choices;
 * without a person to ask or anything to pick, `E_MISSING_PARAMETER` naming the flag.
 */
export async function promptSelect<TValue extends string>(
  flag: string,
  message: string,
  choices: Choice<TValue>[],
  options: InteractivityOptions,
): Promise<TValue> {
  if (choices.length === 0 || !isInteractive(options)) {
    throw new MissingParameterError(flag);
  }
  // clack types an option through a conditional type a generic value cannot satisfy, so the pick is typed back from the choices
  const answer = await select<string>({ message, options: choices });
  if (isCancel(answer)) {
    throw new MissingParameterError(flag);
  }
  return answer as TValue;
}

/**
 * A required secret the command line left out, asked for without showing what is typed;
 * without a person to ask, `E_MISSING_PARAMETER` naming the flag.
 */
export function promptSecret(
  flag: string,
  message: string,
  options: InteractivityOptions,
): Promise<string> {
  return promptInput(password, flag, message, options);
}

/**
 * A required text parameter the command line left out, asked for; without a person to ask, `E_MISSING_PARAMETER` naming the flag.
 */
export function promptText(
  flag: string,
  message: string,
  options: InteractivityOptions,
): Promise<string> {
  return promptInput(text, flag, message, options);
}

async function promptInput(
  ask: typeof password | typeof text,
  flag: string,
  message: string,
  options: InteractivityOptions,
): Promise<string> {
  if (!isInteractive(options)) {
    throw new MissingParameterError(flag);
  }
  const answer = await ask({
    message,
    validate: value => (value?.trim() ? undefined : 'Enter a value.'),
  });
  if (isCancel(answer)) {
    throw new MissingParameterError(flag);
  }
  return answer;
}
