// For the tests that run a repo shell script with its tools stubbed on PATH.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** bash: the runner's, or Git for Windows' own usr/bin/bash.exe -- a bare `bash` there
 *  can be WSL's, and Git's bin/bash.exe puts its own git ahead of the stubs on PATH. */
export function findBash(): string | null {
  if (process.platform !== 'win32') return 'bash';
  try {
    const gitCore = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
    const bash = join(resolve(gitCore, '../../..'), 'usr', 'bin', 'bash.exe');
    return existsSync(bash) ? bash : null;
  } catch {
    return null;
  }
}
