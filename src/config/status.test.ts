/**
 * The wording of the profile surface — the part of A5 a user actually reads.
 *
 * Acceptance matrix A5: "an explicit *no profile configured* surface; silent
 * wrong-profile spam = FAIL". So the assertions here are about honesty, not
 * prose: every state SAYS which config governs (or that none does), the
 * ungoverned states are warning-tinted rather than quietly informational, and
 * every state offers an action that fits it — configure when there is nothing
 * to open, open when there is a file to fix.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CONFIGURE_PROFILE_COMMAND, OPEN_PROFILE_CONFIG_COMMAND } from './contribution.ts';
import type { ProfileResolution } from './profile.ts';
import { profileStatusView } from './status.ts';

const view = (r: ProfileResolution) => profileStatusView(r);

describe('profileStatusView', () => {
  it('names the profile and the file it came from', () => {
    const got = view({ state: 'configured', profile: 'modern', configPath: '/w/.m-cli.toml' });
    assert.equal(got.text, 'profile: modern — .m-cli.toml');
    assert.equal(got.severity, 'information');
    assert.match(got.detail, /\/w\/\.m-cli\.toml/);
    assert.equal(got.command, OPEN_PROFILE_CONFIG_COMMAND);
  });

  it('names a pyproject.toml as the governing file when that is what governs', () => {
    const got = view({ state: 'configured', profile: 'vista', configPath: '/w/pyproject.toml' });
    assert.equal(got.text, 'profile: vista — pyproject.toml');
  });

  it('says plainly when nothing is configured, and offers to configure it', () => {
    const got = view({ state: 'unconfigured' });
    assert.equal(got.text, 'no M profile configured — default rules in effect');
    assert.equal(got.severity, 'warning');
    assert.equal(got.command, CONFIGURE_PROFILE_COMMAND);
  });

  it('warns that the default rule set may not match this project', () => {
    const got = view({ state: 'unconfigured' });
    assert.match(got.detail, /\.m-cli\.toml/, 'names the file that would fix it');
    assert.match(got.detail, /default/, 'names what is in effect meanwhile');
    assert.match(got.detail, /vista/i, 'points VistA-era code at the profile it needs');
  });

  it('distinguishes a config that governs but sets no profile — and opens it, never overwrites', () => {
    const got = view({ state: 'no-profile', configPath: '/w/.m-cli.toml' });
    assert.equal(got.text, 'no M profile configured — default rules in effect');
    assert.equal(got.severity, 'warning');
    assert.match(got.detail, /\/w\/\.m-cli\.toml/);
    assert.match(got.detail, /\[lint\] rules/);
    assert.equal(got.command, OPEN_PROFILE_CONFIG_COMMAND);
  });

  it('admits it when the governing config could not be read', () => {
    const got = view({ state: 'unreadable', configPath: '/w/.m-cli.toml' });
    assert.match(got.text, /could not be read/);
    assert.equal(got.severity, 'warning');
    assert.equal(got.command, OPEN_PROFILE_CONFIG_COMMAND);
  });

  it('never produces an empty surface — a blank status reads as "fine"', () => {
    const states: ProfileResolution[] = [
      { state: 'configured', profile: 'modern', configPath: '/w/.m-cli.toml' },
      { state: 'no-profile', configPath: '/w/.m-cli.toml' },
      { state: 'unreadable', configPath: '/w/.m-cli.toml' },
      { state: 'unconfigured' },
    ];
    for (const state of states) {
      const got = view(state);
      assert.notEqual(got.text.trim(), '', `${state.state} has status text`);
      assert.notEqual(got.detail.trim(), '', `${state.state} has a tooltip detail`);
      assert.notEqual(got.commandTitle.trim(), '', `${state.state} names its action`);
    }
  });
});
