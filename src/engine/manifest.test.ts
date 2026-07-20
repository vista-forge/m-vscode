/**
 * The manifest is a PROJECTION of the code — red-gated, not reviewed.
 *
 * Same discipline as `src/lang/contribution.test.ts` (language registration)
 * and the language-server half of `src/lsp/settings.test.ts`. A contributed
 * default that drifts from the code silently changes behaviour for every user
 * who never touched the setting; a contributed COMMAND that nothing registers
 * is a menu entry that does nothing when clicked. Both are the silent-failure
 * class this phase exists to kill, so both are assertions.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS } from '../lsp/settings.ts';
import { ENGINE_COMMANDS, ENGINE_SETTING_DEFAULTS } from './contribution.ts';
import { resolveEngineSettings } from './settings.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    configuration: { properties: Record<string, { default?: unknown; enum?: string[] }> };
  };
};
const props = pkg.contributes.configuration.properties;

describe('engine settings contribution', () => {
  for (const [key, want] of Object.entries(ENGINE_SETTING_DEFAULTS)) {
    it(`declares the code's default for ${key}`, () => {
      assert.ok(key in props, `package.json is missing ${key}`);
      assert.deepEqual(props[key]?.default, want);
    });
  }

  it('offers exactly the engines the code accepts', () => {
    assert.deepEqual(props['mLanguageTools.engine']?.enum, ['ydb', 'iris']);
  });

  it('the declared defaults are the ones resolveEngineSettings produces from an empty config', () => {
    const resolved = resolveEngineSettings({});
    assert.equal(ENGINE_SETTING_DEFAULTS['mLanguageTools.engine'], resolved.engine);
    assert.equal(ENGINE_SETTING_DEFAULTS['mLanguageTools.docker'], resolved.docker);
    assert.equal(ENGINE_SETTING_DEFAULTS['mLanguageTools.namespace'], resolved.namespace);
    assert.equal(
      ENGINE_SETTING_DEFAULTS['mLanguageTools.engine.lockWaitSeconds'],
      resolved.lockWaitSeconds,
    );
  });
});

describe('the manifest contributes nothing nobody reads', () => {
  // The single exhaustive assertion over ALL settings — the LSP half asserts
  // its own keys are present, this asserts the union is exactly the manifest.
  it('every contributed setting is read by the code', () => {
    const owned = new Set([
      'mLanguageTools.enable',
      'mLanguageTools.serverPath',
      'mLanguageTools.serverArgs',
      'mLanguageTools.lint.profile',
      'mLanguageTools.diagnostics.debounceMs',
      'mLanguageTools.diagnostics.largeFileBytes',
      ...Object.keys(ENGINE_SETTING_DEFAULTS),
    ]);
    assert.deepEqual(Object.keys(props).sort(), [...owned].sort());
  });

  it('the language-server defaults are still the ones the code ships', () => {
    assert.equal(props['mLanguageTools.enable']?.default, DEFAULT_SETTINGS.enable);
  });
});

describe('engine commands contribution', () => {
  const contributed = pkg.contributes.commands.map((c) => c.command);

  for (const id of ENGINE_COMMANDS) {
    it(`${id} is contributed`, () => {
      assert.ok(contributed.includes(id), `package.json does not contribute ${id}`);
    });
  }

  it('every contributed command id is unique', () => {
    assert.equal(new Set(contributed).size, contributed.length);
  });

  it('every contributed command has a non-empty, M-prefixed title', () => {
    for (const c of pkg.contributes.commands) {
      assert.notEqual(c.title.trim(), '');
      assert.ok(c.title.startsWith('M: '), `${c.command} title should start with "M: "`);
    }
  });
});
