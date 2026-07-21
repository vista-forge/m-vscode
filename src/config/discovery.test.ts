/**
 * The walk must MIRROR m-cli's `config.FindConfig` — a client that disagrees
 * with the server about which file governs a document would report a profile
 * the diagnostics do not come from, which is worse than reporting nothing.
 * The cases below are the behaviours that port is made of, including the two
 * that are easy to get wrong: the `.git` boundary, and the per-level check
 * running BEFORE that boundary check.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  CONFIG_FILENAME,
  type FileSystemProbe,
  findConfig,
  pyprojectGoverns,
} from './discovery.ts';

/** An in-memory filesystem: absolute path -> file contents; dirs are implied. */
function fakeFs(files: Record<string, string>): FileSystemProbe {
  const dirs = new Set<string>();
  for (const path of Object.keys(files)) {
    let dir = path.slice(0, path.lastIndexOf('/'));
    while (dir !== '') {
      dirs.add(dir);
      dir = dir.slice(0, dir.lastIndexOf('/'));
    }
  }
  return {
    isFile: (path) => path in files,
    exists: (path) => path in files || dirs.has(path),
    read: (path) => files[path],
  };
}

describe('findConfig', () => {
  it('finds a config in the start directory itself', () => {
    const fs = fakeFs({ '/w/p/.m-cli.toml': '', '/w/p/A.m': '' });
    assert.equal(findConfig('/w/p', fs), '/w/p/.m-cli.toml');
  });

  it('walks up to a parent directory', () => {
    const fs = fakeFs({ '/w/.m-cli.toml': '', '/w/p/sub/A.m': '' });
    assert.equal(findConfig('/w/p/sub', fs), '/w/.m-cli.toml');
  });

  it('returns undefined when nothing governs the directory', () => {
    const fs = fakeFs({ '/w/p/A.m': '' });
    assert.equal(findConfig('/w/p', fs), undefined);
  });

  it('stops at a .git boundary — a config above a repo does NOT govern it', () => {
    const fs = fakeFs({ '/w/.m-cli.toml': '', '/w/p/.git/HEAD': '', '/w/p/A.m': '' });
    assert.equal(findConfig('/w/p', fs), undefined);
  });

  it('still finds a config sitting BESIDE the .git it would stop at', () => {
    const fs = fakeFs({ '/w/p/.m-cli.toml': '', '/w/p/.git/HEAD': '' });
    assert.equal(findConfig('/w/p', fs), '/w/p/.m-cli.toml');
  });

  it('prefers .m-cli.toml over a pyproject.toml at the same level', () => {
    const fs = fakeFs({
      '/w/.m-cli.toml': '',
      '/w/pyproject.toml': '[tool.m-cli]\n',
    });
    assert.equal(findConfig('/w', fs), '/w/.m-cli.toml');
  });

  it('accepts a pyproject.toml only when it actually carries a [tool.m-cli] table', () => {
    const withTable = fakeFs({ '/w/pyproject.toml': '[tool.m-cli]\n[lint]\n' });
    assert.equal(findConfig('/w', withTable), '/w/pyproject.toml');
    const without = fakeFs({ '/w/pyproject.toml': '[tool.ruff]\nline-length = 100\n' });
    assert.equal(findConfig('/w', without), undefined);
  });

  it('starts from the containing directory when handed a file', () => {
    const fs = fakeFs({ '/w/p/.m-cli.toml': '', '/w/p/A.m': '' });
    assert.equal(findConfig('/w/p/A.m', fs), '/w/p/.m-cli.toml');
  });
});

describe('pyprojectGoverns', () => {
  const cases: Array<[string, string, boolean]> = [
    ['section header', '[tool.m-cli]\n', true],
    ['nested section header', '[tool.m-cli.lint]\nrules = "vista"\n', true],
    ['quoted key in the header', '[tool."m-cli"]\n', true],
    ['key inside a [tool] table', '[tool]\nm-cli = { lint = { rules = "vista" } }\n', true],
    ['another tool entirely', '[tool.ruff]\n', false],
    ['a bare mention in a comment', '# m-cli is used here\n', false],
    ['empty', '', false],
  ];
  for (const [name, text, want] of cases) {
    it(`${want ? 'accepts' : 'rejects'} ${name}`, () => {
      assert.equal(pyprojectGoverns(text), want);
    });
  }
});

describe('findConfig against a real filesystem', () => {
  it('resolves through the default node probe', () => {
    const root = mkdtempSync(join(tmpdir(), 'm-vscode-discovery-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, CONFIG_FILENAME), '[lint]\nrules = "modern"\n');
    assert.equal(findConfig(join(root, 'src')), join(root, CONFIG_FILENAME));
  });
});
