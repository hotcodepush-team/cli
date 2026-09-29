import { describe, expect, it } from 'vitest';
import { resolveBrowserCommand } from './browser.js';

const URL = 'https://console.example.com/device?user_code=WDJBMJHT';

describe('browser', () => {
  it.each<[NodeJS.Platform, string, string[]]>([
    ['darwin', 'open', [URL]],
    ['linux', 'xdg-open', [URL]],
    ['win32', 'cmd', ['/c', 'start', '""', URL]],
  ])('should open the URL when on %s', (platform, command, args) => {
    expect(resolveBrowserCommand(platform, URL)).toEqual([command, args]);
  });
});
