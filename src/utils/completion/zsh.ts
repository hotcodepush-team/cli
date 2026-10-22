import type { CompletionCommand, CompletionOption } from './command-tree.js';
import { quotePosixWord } from './posix-quote.js';

/**
 * The zsh completion script: the top-level names and the noun's verbs with their descriptions, then the command's
 * flags through `_arguments`, an enum's choices after its flag and the file names for a free value.
 */
export function buildZshScript(commands: CompletionCommand[]): string {
  return [
    '#compdef hotcodepush',
    '',
    '_hotcodepush() {',
    '  local -a completions',
    '  if (( CURRENT == 2 )); then',
    ...buildDescribeLines('    ', 'hotcodepush command', commands),
    '  fi',
    '  if (( CURRENT == 3 )) && [[ ${words[CURRENT]} != -* ]]; then',
    '    case ${words[2]} in',
    ...commands
      .filter(({ verbs }) => verbs.length > 0)
      .flatMap(({ name, verbs }) => [
        `      ${quotePosixWord(name)})`,
        ...buildDescribeLines('        ', `${name} command`, verbs),
        '        ;;',
      ]),
    '    esac',
    '  fi',
    '  case "${words[2]} ${words[3]}" in',
    ...buildCommandArms(commands),
    '  esac',
    '}',
    '',
    '# drops the command words, so _arguments reads the flags as the words of the command they belong to',
    '_hotcodepush_arguments() {',
    '  local command_word_count=$1',
    '  shift',
    '  shift $command_word_count words',
    '  (( CURRENT -= command_word_count ))',
    '  _arguments "$@"',
    '}',
    '',
    'compdef _hotcodepush hotcodepush',
    '',
    '# under fpath this file is the body of _hotcodepush: its first run defines the function, then completes with it',
    'if [ "$funcstack[1]" = "_hotcodepush" ]; then',
    '  _hotcodepush "$@"',
    'fi',
  ].join('\n');
}

/**
 * The arm that hands a command's flags to `_arguments`, and the file names for its arguments where it takes any.
 */
function buildArgumentsArm(
  pattern: string,
  commandWordCount: number,
  { hasArguments, options }: CompletionCommand,
): string[] {
  const specs = [
    ...options.map(buildOptionSpec),
    ...(hasArguments ? ['*:argument:_files'] : []),
  ];
  return [
    `    ${pattern})`,
    `      _hotcodepush_arguments ${commandWordCount} \\`,
    ...specs.map(spec => `        ${quotePosixWord(spec)} \\`),
    '      ;;',
  ];
}

/**
 * One case arm per runnable command, matched on its first two words: the verbs first, so `fingerprint diff` wins over `fingerprint`.
 */
function buildCommandArms(commands: CompletionCommand[]): string[] {
  const verbArms = commands.flatMap(noun =>
    noun.verbs.map(verb =>
      buildArgumentsArm(quotePosixWord(`${noun.name} ${verb.name}`), 2, verb),
    ),
  );
  const standaloneArms = commands
    .filter(({ options }) => options.length > 0)
    .map(command =>
      buildArgumentsArm(`${quotePosixWord(`${command.name} `)}*`, 1, command),
    );
  return [...verbArms, ...standaloneArms].flat();
}

/**
 * The words as `_describe` offers them, each `name:description`, ending the completion.
 */
function buildDescribeLines(
  indentation: string,
  tag: string,
  commands: CompletionCommand[],
): string[] {
  return [
    `${indentation}completions=(`,
    ...commands.map(
      ({ description, name }) =>
        `${indentation}  ${quotePosixWord(`${name}:${description}`)}`,
    ),
    `${indentation})`,
    `${indentation}_describe -t commands ${quotePosixWord(tag)} completions`,
    `${indentation}return`,
  ];
}

/**
 * An `_arguments` spec: the flag with its description in brackets, starred when it may be given again,
 * then for a value the flag's name as the message and an enum's choices or the file names.
 */
function buildOptionSpec({
  choices,
  description,
  hasValue,
  isRepeatable,
  name,
}: CompletionOption): string {
  const flag = `${isRepeatable ? '*' : ''}--${name}[${description.replace(/[[\]\\]/g, '\\$&')}]`;
  if (!hasValue) {
    return flag;
  }
  return `${flag}:${name}:${choices.length > 0 ? `(${choices.join(' ')})` : '_files'}`;
}
