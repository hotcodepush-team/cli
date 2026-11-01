import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveGitProvenance, resolveRemoteSlug } from './git-provenance.js';

describe('git provenance', () => {
  let directoryPath = '';

  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'hotcodepush-git-'));
    // An inherited GIT_DIR, as `git rebase --exec` sets, would send every git process here to the enclosing repository.
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('GIT_')) {
        vi.stubEnv(name, undefined);
      }
    }
  });

  afterEach(() => {
    rmSync(directoryPath, { force: true, recursive: true });
  });

  function runGit(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: directoryPath,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: 'anna@example.test',
        GIT_AUTHOR_NAME: 'Anna',
        GIT_COMMITTER_EMAIL: 'anna@example.test',
        GIT_COMMITTER_NAME: 'Anna',
      },
    }).trim();
  }

  it('should detect the commit, ref, message subject, dirty state and the remote slug', async () => {
    runGit('init', '-q', '-b', 'main');
    runGit(
      'remote',
      'add',
      'origin',
      'https://user:token@github.com/acme/shop.git',
    );
    writeFileSync(join(directoryPath, 'a.txt'), 'a');
    runGit('add', 'a.txt');
    runGit('commit', '-q', '-m', 'fix: cart crash', '-m', 'the body');
    writeFileSync(join(directoryPath, 'b.txt'), 'b');

    const provenance = await resolveGitProvenance(directoryPath, {});

    expect(provenance).toEqual({
      gitMessage: 'fix: cart crash',
      gitRef: 'main',
      gitRemote: 'github.com/acme/shop',
      gitSha: runGit('rev-parse', 'HEAD'),
      isGitDirty: true,
    });
  });

  it('should answer nulls outside a repository', async () => {
    expect(await resolveGitProvenance(directoryPath, {})).toEqual({
      gitMessage: null,
      gitRef: null,
      gitRemote: null,
      gitSha: null,
      isGitDirty: null,
    });
  });

  it('should keep the typed flags with --no-git and detect nothing', async () => {
    expect(
      await resolveGitProvenance(directoryPath, {
        gitMessage: 'chore: release',
        gitRef: 'release/1.4',
        gitSha: 'ab12c3f',
        noGit: true,
      }),
    ).toEqual({
      gitMessage: 'chore: release',
      gitRef: 'release/1.4',
      gitRemote: null,
      gitSha: 'ab12c3f',
      isGitDirty: null,
    });
  });

  it('should strip the credentials and the suffix from an HTTPS or SSH remote', () => {
    expect(
      resolveRemoteSlug('https://user:token@github.com/acme/shop.git'),
    ).toBe('github.com/acme/shop');
    expect(resolveRemoteSlug('git@github.com:acme/shop.git')).toBe(
      'github.com/acme/shop',
    );
    expect(resolveRemoteSlug('ssh://git@gitlab.com/acme/shop')).toBe(
      'gitlab.com/acme/shop',
    );
  });
});
