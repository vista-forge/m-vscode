/**
 * The templates are proven against the REAL `m`, not against our reading of
 * m-cli's config grammar.
 *
 * m-cli treats a near-miss key, an unknown `[fmt] rules` preset, or an invalid
 * value as a HARD error (T0-6/T2-9) — deliberately, because `target-engine`
 * (hyphen) sat silently ignored in five repos for months. That makes a written
 * template a liability if it is wrong: the one-click remedy would leave the
 * project worse off than unconfigured, with `m lint` refusing to run at all.
 *
 * Like `equivalence.e2e.test.ts`, this FAILS rather than skips when `m` is
 * missing: an unproven template is not a proven one. It is engine-free — `m
 * lint` never touches an M engine.
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILENAME } from './discovery.ts';
import { PROFILE_TEMPLATES } from './templates.ts';

const here = dirname(fileURLToPath(import.meta.url));
const routine = join(here, '..', 'lsp', 'fixtures', 'capabilities', 'ZZCAP.m');

interface LintEnvelope {
  ok: boolean;
  data?: { findings?: number };
  diagnostics?: Array<{ rule: string }>;
}

/** Run `m lint` inside `dir`, returning the parsed envelope. */
function lint(dir: string): LintEnvelope {
  const out = execFileSync('m', ['lint', '-o', 'json', 'ZZCAP.m'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return JSON.parse(out) as LintEnvelope;
}

function project(config?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'm-vscode-template-'));
  copyFileSync(routine, join(dir, 'ZZCAP.m'));
  if (config !== undefined) writeFileSync(join(dir, CONFIG_FILENAME), config);
  return dir;
}

describe('the written templates are accepted by the real `m`', () => {
  for (const template of PROFILE_TEMPLATES) {
    it(`${template.id}: \`m lint\` loads the config and reports its profile's findings`, () => {
      const envelope = lint(project(template.content));
      assert.equal(envelope.ok, true, `m lint rejected the ${template.id} template`);
      const viaFlag = JSON.parse(
        execFileSync('m', ['lint', '-o', 'json', '--profile', template.profile, 'ZZCAP.m'], {
          cwd: project(),
          encoding: 'utf8',
        }),
      ) as LintEnvelope;
      assert.deepEqual(
        (envelope.diagnostics ?? []).map((d) => d.rule).sort(),
        (viaFlag.diagnostics ?? []).map((d) => d.rule).sort(),
        `the ${template.id} template must select the same rules as --profile ${template.profile}`,
      );
    });
  }

  it('the vista template visibly changes what an unconfigured folder reports', () => {
    // This is the A5 remedy's whole point, and the same before/after the
    // in-host smoke suite asserts through the editor: writing the template
    // must not be a no-op the user cannot see.
    const before = lint(project());
    const after = lint(project(PROFILE_TEMPLATES[1]?.content));
    assert.equal(before.data?.findings ?? 0, 0, 'the unnamed default finds nothing here');
    assert.ok(
      (after.data?.findings ?? 0) > 0,
      'the vista profile finds the SAC violations the default rule set does not',
    );
  });
});
