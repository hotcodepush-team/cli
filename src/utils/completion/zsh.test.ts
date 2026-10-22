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

  it("should hand each command's flags to _arguments without its command words", () => {
    expect(script).toContain(
      [
        "    'channel create')",
        '      _hotcodepush_arguments 2 \\',
        `        '--name[The channel'\\''s name.]:name:_files' \\`,
        `        '--failure-action[What auto-pause does.]:failure-action:(none pause)' \\`,
        `        '--protected[Whether only \\[Owners\\] change it.]' \\`,
        `        '--json[Print machine output as JSON.]' \\`,
        '      ;;',
      ].join('\n'),
    );
    expect(script).toContain(
      ["    'fingerprint '*)", '      _hotcodepush_arguments 1 \\'].join('\n'),
    );
  });

  it('should match a verb before the standalone command it follows', () => {
    expect(script.indexOf(`    'fingerprint diff')`)).toBeLessThan(
      script.indexOf(`    'fingerprint '*)`),
    );
  });

  it('should register the function for hotcodepush when it is loaded', () => {
    expect(script).toMatch(/^#compdef hotcodepush\n/);
    expect(script).toMatch(/\ncompdef _hotcodepush hotcodepush$/);
  });
});
