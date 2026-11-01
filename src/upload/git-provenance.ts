import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Stored on the control plane only. Every field is null without a repository.
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

// `--no-git` skips the detection for a pipeline without a checkout, while the typed flags still apply.
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

// Drops the credentials, so `github.com/acme/shop` comes from an HTTPS or an SSH URL alike.
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

// Null when git is missing, the directory is no repository or the command fails.
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
