import open from 'open';

// Failures are ignored, since the command always prints the URL too.
// A headless machine or a missing `xdg-open` opens no browser.
export async function openBrowser(url: string): Promise<void> {
  await open(url).catch(() => undefined);
}
