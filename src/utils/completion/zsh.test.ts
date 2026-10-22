import { describe, expect, it } from 'vitest';
import { COMPLETION_COMMANDS } from '../../../test/fixtures.js';
import { buildZshScript } from './zsh.js';

describe('buildZshScript', () => {
  const script = buildZshScript(COMPLETION_COMMANDS);

  it('should describe the top-level names as the first word', () => {
    expect(script).toContain(
      [
        '    completions=(',
        "      'channel:create'",
        "      'fingerprint:Print the fingerprint.'",
        '    )',
        "    _describe -t commands 'hotcodepush command' completions",
      ].join('\n'),
    );
  });

  it("should describe a noun's verbs as the second word", () => {
    expect(script).toContain(
      [
        "      'channel')",
        '        completions=(',
        `          'create:Create a channel: the app'\\''s [preview] one.'`,
        '        )',
        "        _describe -t commands 'channel command' completions",
      ].join('\n'),
    );
  });

  it("should hand each command's flags to _arguments without its command words, a repeatable one starred", () => {
    expect(script).toContain(
      [
        "    'channel create')",
        '      _hotcodepush_arguments 2 \\',
        `        '--name[The channel'\\''s name.]:name:_files' \\`,
        `        '--failure-action[What auto-pause does.]:failure-action:(none pause)' \\`,
        `        '--protected[Whether only \\[Owners\\] change it.]' \\`,
        `        '*--label[A label it carries, repeatable.]:label:_files' \\`,
        `        '--json[Print machine output as JSON.]' \\`,
        '      ;;',
      ].join('\n'),
    );
    expect(script).toContain(
      ["    'fingerprint '*)", '      _hotcodepush_arguments 1 \\'].join('\n'),
    );
  });

  it('should offer the file names for the arguments of a command that takes them', () => {
    expect(script).toContain(
      [
        "    'fingerprint diff')",
        '      _hotcodepush_arguments 2 \\',
        `        '--json[Print machine output as JSON.]' \\`,
        `        '*:argument:_files' \\`,
        '      ;;',
      ].join('\n'),
    );
  });

  it('should match a verb before the standalone command it follows', () => {
    expect(script.indexOf(`    'fingerprint diff')`)).toBeLessThan(
      script.indexOf(`    'fingerprint '*)`),
    );
  });

  it('should register the function for hotcodepush when it is loaded', () => {
    expect(script).toMatch(/^#compdef hotcodepush\n/);
    expect(script).toContain('\ncompdef _hotcodepush hotcodepush\n');
  });

  it('should complete on its first run when it is installed under fpath as the body of _hotcodepush', () => {
    expect(script.split('\n').slice(-3)).toEqual([
      'if [ "$funcstack[1]" = "_hotcodepush" ]; then',
      '  _hotcodepush "$@"',
      'fi',
    ]);
  });
});
