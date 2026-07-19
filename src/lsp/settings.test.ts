import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, LINT_PROFILES, resolveSettings, serverLaunch } from './settings.ts';

describe('resolveSettings', () => {
  const cases: {
    name: string;
    raw: Record<string, unknown> | undefined;
    want: Partial<ReturnType<typeof resolveSettings>>;
  }[] = [
    { name: 'undefined yields the defaults', raw: undefined, want: DEFAULT_SETTINGS },
    { name: 'empty object yields the defaults', raw: {}, want: DEFAULT_SETTINGS },
    {
      name: 'explicit values win',
      raw: {
        enable: false,
        serverPath: '/opt/bin/m',
        serverArgs: ['lsp', '--verbose'],
        lintProfile: 'pedantic',
        debounceMs: 750,
        largeFileBytes: 1024,
      },
      want: {
        enable: false,
        serverPath: '/opt/bin/m',
        serverArgs: ['lsp', '--verbose'],
        lintProfile: 'pedantic',
        debounceMs: 750,
        largeFileBytes: 1024,
      },
    },
    {
      name: 'wrong types fall back to the defaults rather than crashing activation',
      raw: { enable: 'yes', serverPath: 42, serverArgs: 'lsp', debounceMs: 'fast' },
      want: DEFAULT_SETTINGS,
    },
    {
      name: 'a blank server path falls back to `m` on PATH',
      raw: { serverPath: '   ' },
      want: { serverPath: 'm' },
    },
    {
      name: 'a non-string entry invalidates the whole args array',
      raw: { serverArgs: ['lsp', 7] },
      want: { serverArgs: ['lsp'] },
    },
    {
      name: 'an empty args array is honoured (server takes no flags today)',
      raw: { serverArgs: [] },
      want: { serverArgs: [] },
    },
    { name: 'negative debounce clamps to zero', raw: { debounceMs: -5 }, want: { debounceMs: 0 } },
    {
      name: 'absurd debounce clamps to the ceiling',
      raw: { debounceMs: 999_999 },
      want: { debounceMs: 10_000 },
    },
    {
      name: 'a non-integer debounce is floored',
      raw: { debounceMs: 300.7 },
      want: { debounceMs: 300 },
    },
    {
      name: 'largeFileBytes of 0 disables the threshold',
      raw: { largeFileBytes: 0 },
      want: { largeFileBytes: 0 },
    },
    {
      name: 'a negative largeFileBytes clamps to 0 (disabled)',
      raw: { largeFileBytes: -1 },
      want: { largeFileBytes: 0 },
    },
    {
      name: 'an unknown lint profile is rejected (fall back to project config)',
      raw: { lintProfile: 'nonsense' },
      want: { lintProfile: '' },
    },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const got = resolveSettings(tc.raw);
      for (const [k, v] of Object.entries(tc.want)) {
        assert.deepEqual(got[k as keyof typeof got], v, `key ${k}`);
      }
    });
  }

  it('never returns the shared default object (callers may mutate)', () => {
    const a = resolveSettings(undefined);
    const b = resolveSettings(undefined);
    assert.notEqual(a, DEFAULT_SETTINGS);
    assert.notEqual(a, b);
  });
});

describe('serverLaunch', () => {
  it('launches `m lsp` over stdio by default', () => {
    const got = serverLaunch(resolveSettings(undefined));
    assert.equal(got.command, 'm');
    assert.deepEqual(got.args, ['lsp']);
  });

  it('honours an absolute server path', () => {
    const got = serverLaunch(resolveSettings({ serverPath: '/opt/bin/m' }));
    assert.equal(got.command, '/opt/bin/m');
  });

  it('omits initializationOptions when the profile comes from the project config', () => {
    const got = serverLaunch(resolveSettings({}));
    assert.equal(got.initializationOptions, undefined);
  });

  it('passes an explicit profile through as an initialization option', () => {
    const got = serverLaunch(resolveSettings({ lintProfile: 'modern' }));
    assert.deepEqual(got.initializationOptions, { profile: 'modern' });
  });
});

/**
 * The manifest is a PROJECTION of these constants — the same discipline
 * `contribution.test.ts` applies to the language registration (ruling D2). A
 * setting whose default drifts from the code silently changes behaviour for
 * every user who never touched it, so drift is red-gated rather than reviewed.
 */
describe('package.json configuration contribution', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    contributes: {
      configuration: { properties: Record<string, { default?: unknown; enum?: string[] }> };
    };
  };
  const props = pkg.contributes.configuration.properties;

  const expected: Record<string, unknown> = {
    'mLanguageTools.enable': DEFAULT_SETTINGS.enable,
    'mLanguageTools.serverPath': DEFAULT_SETTINGS.serverPath,
    'mLanguageTools.serverArgs': [...DEFAULT_SETTINGS.serverArgs],
    'mLanguageTools.lint.profile': DEFAULT_SETTINGS.lintProfile,
    'mLanguageTools.diagnostics.debounceMs': DEFAULT_SETTINGS.debounceMs,
    'mLanguageTools.diagnostics.largeFileBytes': DEFAULT_SETTINGS.largeFileBytes,
  };

  it('contributes exactly the settings the code reads — no more, no less', () => {
    assert.deepEqual(Object.keys(props).sort(), Object.keys(expected).sort());
  });

  for (const [key, want] of Object.entries(expected)) {
    it(`declares the code's default for ${key}`, () => {
      assert.deepEqual(props[key]?.default, want);
    });
  }

  it('offers every lint profile the code accepts, plus the empty default', () => {
    assert.deepEqual(props['mLanguageTools.lint.profile']?.enum, ['', ...LINT_PROFILES]);
  });
});
