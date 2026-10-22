import { z } from 'zod';
import type { Command } from '../command-registry.js';
import { resolveFlagName } from '../flag-name.js';

/**
 * A word that follows `hotcodepush` or a noun: a command, a noun with its verbs, or both, as `fingerprint` is.
 */
export interface CompletionCommand {
  description: string;
  name: string;
  options: CompletionOption[];
  verbs: CompletionCommand[];
}

/**
 * An option as the command line takes it: its kebab-case flag name, whether a value follows it, and an enum's choices.
 */
export interface CompletionOption {
  choices: string[];
  description: string;
  hasValue: boolean;
  name: string;
}

/**
 * The registered commands as the two-level tree the command line spells: the nouns and the standalone commands, each noun's verbs below it.
 * A noun that runs nothing itself is described by its verbs.
 */
export function resolveCommandTree(
  commands: Record<string, Command>,
): CompletionCommand[] {
  const commandEntries = Object.entries(commands);
  const topLevelNames = new Set(
    commandEntries.map(([commandName]) => commandName.split(' ')[0] ?? ''),
  );
  return [...topLevelNames].map(topLevelName => {
    const verbs = commandEntries
      .filter(([commandName]) => commandName.startsWith(`${topLevelName} `))
      .map(([commandName, command]) =>
        resolveCompletionCommand(
          commandName.slice(topLevelName.length + 1),
          command,
        ),
      );
    const topLevelCommand = commands[topLevelName];
    return topLevelCommand === undefined
      ? {
          description: verbs.map(({ name }) => name).join(', '),
          name: topLevelName,
          options: [],
          verbs,
        }
      : { ...resolveCompletionCommand(topLevelName, topLevelCommand), verbs };
  });
}

/**
 * A boolean, or a union with one, as `--protected` also reads `true` or `false` as text: zodline reads the flag alone as true.
 */
function isBooleanFlag(schema: z.core.$ZodType): boolean {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return isBooleanFlag(schema.unwrap());
  }
  if (schema instanceof z.ZodUnion) {
    return schema.options.some(isBooleanFlag);
  }
  return schema instanceof z.ZodBoolean;
}

/**
 * The choices of an enum, also inside an optional, a repeatable flag or a comma list, whose pipe splits the text before it checks each choice.
 */
function resolveChoices(schema: z.core.$ZodType): string[] {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return resolveChoices(schema.unwrap());
  }
  if (schema instanceof z.ZodPipe) {
    return resolveChoices(schema.out);
  }
  if (schema instanceof z.ZodArray) {
    return resolveChoices(schema.element);
  }
  return schema instanceof z.ZodEnum ? schema.options.map(String) : [];
}

function resolveCompletionCommand(
  name: string,
  command: Command,
): CompletionCommand {
  const shape: Record<string, z.ZodType> = command.options?.schema.shape ?? {};
  return {
    description: command.description ?? '',
    name,
    options: Object.entries(shape).map(([key, schema]) =>
      resolveCompletionOption(key, schema),
    ),
    verbs: [],
  };
}

function resolveCompletionOption(
  key: string,
  schema: z.ZodType,
): CompletionOption {
  const hasValue = !isBooleanFlag(schema);
  return {
    choices: hasValue ? resolveChoices(schema) : [],
    description: schema.description ?? '',
    hasValue,
    name: resolveFlagName(key),
  };
}
