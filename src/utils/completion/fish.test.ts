import { describe, expect, it } from 'vitest';
import { COMPLETION_COMMANDS } from '../../../test/fixtures.js';
import { buildFishScript } from './fish.js';

describe('buildFishScript', () => {
  const lines = buildFishScript(COMPLETION_COMMANDS).split('\n');

  it('should describe the top-level names as the first word, without the file names', () => {
    expect(lines).toContain(
      "complete -c hotcodepush -f -n __hotcodepush_needs_command -a 'channel' -d 'create'",
    );
  });

  it("should describe a noun's verbs as the second word", () => {
    expect(lines).toContain(
      "complete -c hotcodepush -f -n '__hotcodepush_needs_verb channel' -a 'create' -d 'Create a channel: the app\\'s [preview] one.'",
    );
  });

  it("should complete each flag of a command, an enum's choices alone and the file names for a free value", () => {
    expect(
      lines.filter(line =>
        line.includes("-n '__hotcodepush_using channel create'"),
      ),
    ).toEqual([
      "complete -c hotcodepush -n '__hotcodepush_using channel create' -l name -r -d 'The channel\\'s name.'",
      "complete -c hotcodepush -n '__hotcodepush_using channel create' -l failure-action -x -a 'none pause' -d 'What auto-pause does.'",
      "complete -c hotcodepush -n '__hotcodepush_using channel create' -l protected -d 'Whether only [Owners] change it.'",
      "complete -c hotcodepush -n '__hotcodepush_using channel create' -l json -d 'Print machine output as JSON.'",
    ]);
  });

  it('should complete the flags of a standalone command only while none of its verbs follows it', () => {
    expect(lines).toContain(
      "complete -c hotcodepush -n '__hotcodepush_using fingerprint; and not __hotcodepush_using fingerprint diff' -l json -d 'Print machine output as JSON.'",
    );
  });

  it('should complete no flag for a noun that runs nothing', () => {
    expect(
      lines.filter(line => line.includes("'__hotcodepush_using channel'")),
    ).toEqual([]);
  });
});
