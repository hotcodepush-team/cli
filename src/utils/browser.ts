import open from 'open';

/**
 * Opens the URL in the default browser through the `open` package, which escapes it for each platform's launcher.
 * Where none opens, a headless machine or a missing `xdg-open`, the URL the command printed is the way.
 */
export async function openBrowser(url: string): Promise<void> {
  await open(url).catch(() => undefined);
}
