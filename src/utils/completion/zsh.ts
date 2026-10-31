import type { CompletionCommand, CompletionOption } from './command-tree.js';
import { buildPosixCaseArms } from './posix-case-arms.js';
import { quotePosixWord } from './posix-quote.js';

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
    ...buildPosixCaseArms(commands, (pattern, command, commandWordCount) =>
      buildArgumentsArm(pattern, commandWordCount, command),
    ),
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
