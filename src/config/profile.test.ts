/**
 * Reading `[lint] rules` out of a config file — the one fact the profile
 * surface states out loud.
 *
 * The honesty rule that shapes every case here: the surface may say "no
 * profile" ONLY when it really read the file and found no `[lint] rules` key.
 * A config file that could not be READ at all resolves to `unreadable` — never
 * to a confident wrong answer, and never to the unconfigured state, which
 * would send the user to write a second config file over the top of one that
 * already governs.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { FileSystemProbe } from './discovery.ts';
import { lintRulesOf, resolveProfile } from './profile.ts';

const probe = (files: Record<string, string>): FileSystemProbe => ({
  isFile: (path) => path in files,
  exists: (path) => path in files || Object.keys(files).some((f) => f.startsWith(`${path}/`)),
  read: (path) => files[path],
});

describe('lintRulesOf — .m-cli.toml', () => {
  const cases: Array<[string, string, ReturnType<typeof lintRulesOf>]> = [
    ['a plain profile', '[lint]\nrules = "vista"\n', { kind: 'profile', profile: 'vista' }],
    ['single quotes', "[lint]\nrules = 'modern'\n", { kind: 'profile', profile: 'modern' }],
    [
      'a comma list',
      '[lint]\nrules = "M-MOD-001,M-MOD-002"\n',
      { kind: 'profile', profile: 'M-MOD-001,M-MOD-002' },
    ],
    [
      'leading comments and blank lines',
      '# hi\n\n[lint]\n\nrules="sac"\n',
      {
        kind: 'profile',
        profile: 'sac',
      },
    ],
    [
      'an inline [lint] table',
      'lint = { rules = "pedantic" }\n',
      { kind: 'profile', profile: 'pedantic' },
    ],
    ['a config with no lint section at all', '[fmt]\nrules = "identity"\n', { kind: 'none' }],
    ['a [lint] section that sets other keys', '[lint]\ntarget_engine = "iris"\n', { kind: 'none' }],
    [
      'a `rules` key in [lint.severity] — a rule-id severity entry, NOT a profile',
      '[lint.severity]\nrules = "nope"\n',
      { kind: 'none' },
    ],
  ];
  for (const [name, text, want] of cases) {
    it(`reads ${name}`, () => {
      assert.deepEqual(lintRulesOf(text, 'm-cli'), want);
    });
  }

  it('ignores a `rules` key belonging to [fmt]', () => {
    assert.deepEqual(lintRulesOf('[fmt]\nrules = "identity"\n', 'm-cli'), { kind: 'none' });
  });

  it('ignores a commented-out rules key', () => {
    assert.deepEqual(lintRulesOf('[lint]\n# rules = "vista"\n', 'm-cli'), { kind: 'none' });
  });
});

describe('lintRulesOf — pyproject.toml', () => {
  it('reads the [tool.m-cli.lint] table', () => {
    assert.deepEqual(lintRulesOf('[tool.m-cli.lint]\nrules = "xindex"\n', 'pyproject'), {
      kind: 'profile',
      profile: 'xindex',
    });
  });

  it('does not read a top-level [lint] table out of a pyproject', () => {
    assert.deepEqual(lintRulesOf('[lint]\nrules = "xindex"\n', 'pyproject'), { kind: 'none' });
  });
});

describe('resolveProfile', () => {
  it('reports the governing config and its profile', () => {
    const got = resolveProfile('/w/p', probe({ '/w/.m-cli.toml': '[lint]\nrules = "modern"\n' }));
    assert.equal(got.state, 'configured');
    assert.equal(got.profile, 'modern');
    assert.equal(got.configPath, '/w/.m-cli.toml');
  });

  it('reports an unconfigured directory', () => {
    const got = resolveProfile('/w/p', probe({ '/w/p/A.m': '' }));
    assert.equal(got.state, 'unconfigured');
    assert.equal(got.configPath, undefined);
    assert.equal(got.profile, undefined);
  });

  it('distinguishes "a config governs but sets no profile" from "no config"', () => {
    const got = resolveProfile('/w', probe({ '/w/.m-cli.toml': '[fmt]\nrules = "identity"\n' }));
    assert.equal(got.state, 'no-profile');
    assert.equal(got.configPath, '/w/.m-cli.toml');
  });

  it('refuses to guess when the config cannot be read', () => {
    const got = resolveProfile('/w', {
      isFile: (p) => p === '/w/.m-cli.toml',
      exists: (p) => p === '/w/.m-cli.toml',
      read: () => undefined,
    });
    assert.equal(got.state, 'unreadable');
    assert.equal(got.configPath, '/w/.m-cli.toml');
  });
});
