import type { CommandDefinition } from 'zodline';
import { UnknownCommandError } from './errors.js';

// zodline types every command it accepts as CommandDefinition<any, any>; a narrower type rejects commands with options or args
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Command = CommandDefinition<any, any>;

/**
 * Space-separated command names, `channel create`, each mapped to a lazy import of its module.
 */
export type CommandRegistry = Record<
  string,
  () => Promise<{ default: Command }>
>;

/**
 * The commands to load for a command line and the arguments to hand to zodline.
 */
export interface Invocation {
  argv: string[];
  commandNames: string[];
}

const MAX_SUGGESTION_DISTANCE = 2;

const SHORT_FLAG_EXPANSIONS: Record<string, string> = {
  '-h': '--help',
  '-v': '--version',
};

export async function loadCommands(
  commandRegistry: CommandRegistry,
  commandNames: string[],
): Promise<Record<string, Command>> {
  const invokedEntries = Object.entries(commandRegistry).filter(([name]) =>
    commandNames.includes(name),
  );
  const loadedEntries = await Promise.all(
    invokedEntries.map(async ([name, importCommand]) => [
      name,
      (await importCommand()).default,
    ]),
  );
  return Object.fromEntries(loadedEntries);
}

/**
 * Picks the registered name closest to what was typed, for the did-you-mean answer to an unknown command.
 */
export function resolveClosestCommandName(
  commandNames: string[],
  words: string[],
): string | undefined {
  let closestCommandName: string | undefined;
  let closestDistance = MAX_SUGGESTION_DISTANCE + 1;
  for (const commandName of commandNames) {
    const typedCommand = words
      .slice(0, commandName.split(' ').length)
      .join(' ');
    const distance = resolveEditDistance(typedCommand, commandName);
    if (distance < closestDistance) {
      closestCommandName = commandName;
      closestDistance = distance;
    }
  }
  return closestCommandName;
}

/**
 * The longest registered name the leading words spell, so `fingerprint diff a b` runs `fingerprint diff`.
 */
export function resolveCommandName(
  commandNames: string[],
  words: string[],
): string | undefined {
  for (let wordCount = words.length; wordCount > 0; wordCount--) {
    const candidate = words.slice(0, wordCount).join(' ');
    if (commandNames.includes(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Decides which commands a command line needs: the one it names, a noun's verbs, or every command for the help.
 * A command line without a command, or with a noun alone, shows the help instead of failing.
 */
export function resolveInvocation(
  commandNames: string[],
  argv: string[],
): Invocation {
  const expandedArgv = argv.map(arg => SHORT_FLAG_EXPANSIONS[arg] ?? arg);
  const words = resolveCommandWords(expandedArgv);
  if (words.length === 0) {
    return { argv: withHelpFlag(expandedArgv), commandNames };
  }
  const commandName = resolveCommandName(commandNames, words);
  if (commandName) {
    return { argv: expandedArgv, commandNames: [commandName] };
  }
  const nounCommandNames = commandNames.filter(name =>
    name.startsWith(`${words[0]} `),
  );
  if (words.length === 1 && nounCommandNames.length > 0) {
    return { argv: withHelpFlag(expandedArgv), commandNames: nounCommandNames };
  }
  throw new UnknownCommandError(
    words.join(' '),
    resolveClosestCommandName(commandNames, words),
  );
}

/**
 * The words before the first flag: a command comes first, its flags after it.
 */
function resolveCommandWords(argv: string[]): string[] {
  const firstFlagIndex = argv.findIndex(arg => arg.startsWith('-'));
  return firstFlagIndex === -1 ? argv : argv.slice(0, firstFlagIndex);
}

/**
 * The Levenshtein distance: the fewest single-character insertions, deletions and substitutions from one text to the other.
 */
function resolveEditDistance(source: string, target: string): number {
  let previousRow = Array.from(
    { length: target.length + 1 },
    (_, index) => index,
  );
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex++) {
    const currentRow = [sourceIndex];
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex++) {
      const substitutionCost =
        source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      currentRow.push(
        Math.min(
          (previousRow[targetIndex] ?? 0) + 1,
          (currentRow[targetIndex - 1] ?? 0) + 1,
          (previousRow[targetIndex - 1] ?? 0) + substitutionCost,
        ),
      );
    }
    previousRow = currentRow;
  }
  return previousRow[target.length] ?? 0;
}

/**
 * zodline reads a repeated flag as an array, so `--help` is added only when it is absent.
 */
function withHelpFlag(argv: string[]): string[] {
  return argv.includes('--help') ? argv : [...argv, '--help'];
}
