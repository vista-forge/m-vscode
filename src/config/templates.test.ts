/**
 * The two config templates the "Configure M profile…" remedy writes.
 *
 * These are the only bytes this extension ever writes into a user's project,
 * so they are asserted here for shape and — in `templates.e2e.test.ts` — for
 * ACCEPTANCE by the real `m` toolchain. A template that m-cli rejects (a
 * near-miss key is a hard error, T2-9) would turn a one-click remedy into a
 * one-click outage.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { lintRulesOf } from './profile.ts';
import { PROFILE_TEMPLATES, templateById } from './templates.ts';

describe('profile templates', () => {
  it('offers exactly the modern and vista shapes', () => {
    assert.deepEqual(
      PROFILE_TEMPLATES.map((t) => t.id),
      ['modern', 'vista'],
    );
  });

  for (const template of PROFILE_TEMPLATES) {
    describe(template.id, () => {
      it('declares the profile it advertises', () => {
        assert.deepEqual(lintRulesOf(template.content, 'm-cli'), {
          kind: 'profile',
          profile: template.profile,
        });
      });

      it('pins fmt to identity — a canonical rewrite is never a default we choose', () => {
        assert.match(template.content, /\[fmt\]\nrules = "identity"/);
      });

      it('carries a comment header explaining what the file is', () => {
        assert.ok(template.content.startsWith('#'), 'template starts with a comment header');
        assert.match(template.content, /m lint/, 'the header names the tool that reads it');
      });

      it('has a label and a description a quick-pick can show', () => {
        assert.notEqual(template.label.trim(), '');
        assert.notEqual(template.description.trim(), '');
      });

      it('ends with exactly one trailing newline', () => {
        assert.match(template.content, /[^\n]\n$/);
      });
    });
  }

  it('resolves a template by id, and only a known id', () => {
    assert.equal(templateById('vista')?.profile, 'vista');
    assert.equal(templateById('modern')?.profile, 'modern');
    assert.equal(templateById('nonsense'), undefined);
  });
});
