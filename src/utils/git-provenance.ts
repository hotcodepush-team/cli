import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * What a bundle records about the commit it was built from, control-plane only; every field null where there is no repository.
 */
export interface GitProvenance {
  gitMessage: string | null;
  gitRef: string | null;
  gitRemote: string | null;
  gitSha: string | null;
  isGitDirty: boolean | null;
}

export interface GitProvenanceOptions {
  gitMessage?: string;
  gitRef?: string;
  gitSha?: string;
  noGit?: boolean;
}

const EMPTY_PROVENANCE: GitProvenance = {
  gitMessage: null,
  gitRef: null,
  gitRemote: null,
  gitSha: null,
  isGitDirty: null,
};

/**
 * The provenance detected from the repository the input lies in, each field overridden by its flag;
 * `--no-git` suppresses the detection while the typed flags still apply, for a pipeline without a checkout.
 */
export async function resolveGitProvenance(
  directoryPath: string,
  options: GitProvenanceOptions,
): Promise<GitProvenance> {
  const detected = options.noGit
    ? EMPTY_PROVENANCE
    : await detectGitProvenance(directoryPath);
  return {
    gitMessage: options.gitMessage ?? detected.gitMessage,
    gitRef: options.gitRef ?? detected.gitRef,
    gitRemote: detected.gitRemote,
    gitSha: options.gitSha ?? detected.gitSha,
    isGitDirty: detected.isGitDirty,
  };
}

/**
 * A remote's slug without its credentials, `github.com/acme/shop`, from an HTTPS or an SSH URL.
 */
export function resolveRemoteSlug(remoteUrl: string): string {
  const sshMatch = /^[^@]+@([^:]+):(.+)$/.exec(remoteUrl);
  if (sshMatch?.[1] !== undefined && sshMatch[2] !== undefined) {
    return `${sshMatch[1]}/${stripGitSuffix(sshMatch[2])}`;
  }
  try {
    const url = new URL(remoteUrl);
    return `${url.host}/${stripGitSuffix(url.pathname)}`;
  } catch {
    return stripGitSuffix(remoteUrl);
  }
}

async function detectGitProvenance(
  directoryPath: string,
): Promise<GitProvenance> {
  const [sha, ref, message, status, remoteUrl] = await Promise.all([
    readGit(directoryPath, ['rev-parse', 'HEAD']),
    readGit(directoryPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    readGit(directoryPath, ['log', '-1', '--format=%s']),
    readGit(directoryPath, ['status', '--porcelain']),
    readGit(directoryPath, ['remote', 'get-url', 'origin']),
  ]);
  if (sha === null) {
    return EMPTY_PROVENANCE;
  }
  return {
    gitMessage: message,
    gitRef: ref,
    gitRemote: remoteUrl === null ? null : resolveRemoteSlug(remoteUrl),
    gitSha: sha,
    isGitDirty: status === null ? null : status.length > 0,
  };
}

/**
 * One git command's trimmed output, or null where git is absent, the directory is no repository or the command fails.
 */
async function readGit(
  directoryPath: string,
  args: string[],
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: directoryPath,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function stripGitSuffix(path: string): string {
  return path.replace(/^\/+/, '').replace(/\.git$/, '');
}
