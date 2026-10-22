import { describe, expect, it } from 'vitest';
import { COMPLETION_COMMANDS } from '../../../test/fixtures.js';
import { buildBashScript } from './bash.js';

describe('buildBashScript', () => {
  const script = buildBashScript(COMPLETION_COMMANDS);

  it('should complete the top-level names as the first word', () => {
    expect(script).toContain(
      `    COMPREPLY=($(compgen -W 'channel fingerprint' -- "$cur"))`,
    );
  });

  it("should complete a noun's verbs as the second word", () => {
    expect(script).toContain(
      `      'channel') COMPREPLY=($(compgen -W 'create' -- "$cur")); return ;;`,
    );
  });

  it("should complete an enum's choices after its flag", () => {
    expect(script).toContain(
      `        '--failure-action') COMPREPLY=($(compgen -W 'none pause' -- "$cur")) ;;`,
    );
  });

  it('should complete nothing after a free value, so bash offers the file names', () => {
    expect(script).toContain(`        '--name') ;;`);
    expect(script).toMatch(
      /\ncomplete -o default -F _hotcodepush hotcodepush$/,
    );
  });

  it("should complete the command's flags otherwise, the boolean and the global ones included", () => {
    expect(script).toContain(
      `        *) COMPREPLY=($(compgen -W '--name --failure-action --protected --json' -- "$cur")) ;;`,
    );
  });

  it('should match a verb before the standalone command it follows', () => {
    expect(script.indexOf(`    'fingerprint diff')`)).toBeLessThan(
      script.indexOf(`    'fingerprint '*)`),
    );
  });
});
