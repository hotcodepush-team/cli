import type { ChildProcess } from 'node:child_process';
import open from 'open';
import { describe, expect, it, vi } from 'vitest';
import { openBrowser } from './browser.js';

vi.mock('open');

const URL = 'https://console.example.com/device?user_code=WDJBMJHT';

describe('browser', () => {
  it('should open the URL through the open package', async () => {
    vi.mocked(open).mockResolvedValueOnce({} as ChildProcess);

    await openBrowser(URL);

    expect(open).toHaveBeenCalledWith(URL);
  });

  it('should settle without an error when no browser opens', async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error('spawn xdg-open ENOENT'));

    await expect(openBrowser(URL)).resolves.toBeUndefined();
  });
});
