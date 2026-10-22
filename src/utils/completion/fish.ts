import type { CompletionCommand, CompletionOption } from './command-tree.js';

/**
 * The fish completion script: the top-level names and the noun's verbs with their descriptions, then the command's
 * flags, an enum's choices after its flag and the file names for a free value.
 */
export function buildFishScript(commands: CompletionCommand[]): string {
  return [
    'function __hotcodepush_needs_command',
    '    test (count (commandline -opc)) -eq 1',
    'end',
    '',
    'function __hotcodepush_needs_verb --argument-names noun',
    '    set -l tokens (commandline -opc)',
    '    test (count $tokens) -eq 2; and test "$tokens[2]" = "$noun"',
    'end',
    '',
    'function __hotcodepush_using --argument-names first_word second_word',
    '    set -l tokens (commandline -opc)',
    '    test "$tokens[2]" = "$first_word"; and test -z "$second_word" -o "$tokens[3]" = "$second_word"',
    'end',
    '',
    ...commands.map(
      ({ description, name }) =>
        `complete -c hotcodepush -f -n __hotcodepush_needs_command -a ${quoteFishWord(name)} -d ${quoteFishWord(description)}`,
    ),
    ...commands.flatMap(noun =>
      noun.verbs.map(
        ({ description, name }) =>
          `complete -c hotcodepush -f -n ${quoteFishWord(`__hotcodepush_needs_verb ${noun.name}`)} -a ${quoteFishWord(name)} -d ${quoteFishWord(description)}`,
      ),
    ),
    ...commands.flatMap(command => [
      ...buildOptionLines(resolveStandaloneCondition(command), command.options),
      ...command.verbs.flatMap(verb =>
        buildOptionLines(
          `__hotcodepush_using ${command.name} ${verb.name}`,
          verb.options,
        ),
      ),
    ]),
  ].join('\n');
}

function buildOptionLines(
  condition: string,
  options: CompletionOption[],
): string[] {
  return options.map(
    option =>
      `complete -c hotcodepush -n ${quoteFishWord(condition)} -l ${option.name}${buildValueArguments(option)} -d ${quoteFishWord(option.description)}`,
  );
}

/**
 * What follows a flag: an enum's choices alone, any value with the file names offered, or nothing for a boolean flag.
 */
function buildValueArguments({ choices, hasValue }: CompletionOption): string {
  if (choices.length > 0) {
    return ` -x -a ${quoteFishWord(choices.join(' '))}`;
  }
  return hasValue ? ' -r' : '';
}

/**
 * The text as one single-quoted fish word, where a backslash and a single quote are the two escapes.
 */
function quoteFishWord(text: string): string {
  return `'${text.replace(/[\\']/g, '\\$&')}'`;
}

/**
 * The command a word runs alone, never while one of its verbs follows it, as `fingerprint diff` follows `fingerprint`.
 */
function resolveStandaloneCondition({
  name,
  verbs,
}: CompletionCommand): string {
  return [
    `__hotcodepush_using ${name}`,
    ...verbs.map(verb => `not __hotcodepush_using ${name} ${verb.name}`),
  ].join('; and ');
}
