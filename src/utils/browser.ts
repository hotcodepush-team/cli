import { spawn } from 'node:child_process';

type BrowserCommand = [command: string, args: string[]];

/**
 * Opens the URL in the default browser without waiting for it.
 * Where none opens, a headless machine or a missing `xdg-open`, the URL the command printed is the way.
 */
export function openBrowser(url: string): void {
  const [command, args] = resolveBrowserCommand(process.platform, url);
  const browserProcess = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    // `start` is a builtin of cmd, whose quoting Node's escaping would break
    windowsVerbatimArguments: true,
  });
  browserProcess.on('error', () => undefined);
  browserProcess.unref();
}

export function resolveBrowserCommand(
  platform: NodeJS.Platform,
  url: string,
): BrowserCommand {
  switch (platform) {
    case 'darwin':
      return ['open', [url]];
    case 'win32':
      return ['cmd', ['/c', 'start', '""', url]];
    default:
      return ['xdg-open', [url]];
  }
}
