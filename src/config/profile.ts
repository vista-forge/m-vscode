/**
 * The lint profile in force for a directory: which config governs it, and
 * which profile that config names.
 *
 * Scope discipline (CLAUDE.md, "thin client, fat toolchain"): this reads ONE
 * key — `[lint] rules` — for the sole purpose of LABELLING what the toolchain
 * is doing. It resolves nothing, validates nothing and applies nothing; m-cli
 * owns config semantics, and a second implementation of them here would be a
 * second source of truth to drift.
 *
 * Honesty rule: `no-profile` means the file was read and carries no
 * `[lint] rules`; `unreadable` means the file exists and could not be read.
 * Neither ever collapses into `unconfigured`, because the remedies differ —
 * one writes a new config, the others open the one that already governs.
 */

import { basename } from 'node:path';
import { CONFIG_FILENAME, type FileSystemProbe, findConfig, nodeFileSystem } from './discovery.js';

export type ProfileState = 'configured' | 'no-profile' | 'unreadable' | 'unconfigured';

export interface ProfileResolution {
  state: ProfileState;
  /** Absolute path of the governing config file; undefined when unconfigured. */
  configPath?: string;
  /** The `[lint] rules` value, when the config names one. */
  profile?: string;
}

export type LintRules = { kind: 'profile'; profile: string } | { kind: 'none' };

/** Which table `[lint] rules` lives in, per config-file flavour. */
const LINT_SECTION = { 'm-cli': 'lint', pyproject: 'tool.m-cli.lint' } as const;
const INLINE_OWNER = { 'm-cli': '', pyproject: 'tool.m-cli' } as const;

export type ConfigFlavour = keyof typeof LINT_SECTION;

/**
 * Read `[lint] rules` out of config text.
 *
 * Handles the section form and TOML's single-line inline-table form (TOML 1.0
 * forbids newlines inside an inline table, so those two shapes are the whole
 * surface). A `rules` key in any other table — `[fmt]`, or `[lint.severity]`,
 * where it would be a rule id — is not a profile and is not reported as one.
 */
export function lintRulesOf(text: string, flavour: ConfigFlavour): LintRules {
  const wantSection = LINT_SECTION[flavour];
  const inlineOwner = INLINE_OWNER[flavour];
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (header?.[1] !== undefined) {
      section = header[1].replace(/["']/g, '').replace(/\s+/g, '');
      continue;
    }
    if (section === wantSection) {
      const value = /^rules\s*=\s*(["'])(.*?)\1/.exec(line);
      if (value?.[2] !== undefined) return { kind: 'profile', profile: value[2] };
      continue;
    }
    if (section === inlineOwner) {
      const inline = /^lint\s*=\s*\{(.*)\}\s*$/.exec(line);
      const value = inline?.[1] === undefined ? null : /rules\s*=\s*(["'])(.*?)\1/.exec(inline[1]);
      if (value?.[2] !== undefined) return { kind: 'profile', profile: value[2] };
    }
  }
  return { kind: 'none' };
}

/** The profile state of a directory (or of a file's directory). */
export function resolveProfile(
  startDir: string,
  fs: FileSystemProbe = nodeFileSystem,
): ProfileResolution {
  const configPath = findConfig(startDir, fs);
  if (configPath === undefined) return { state: 'unconfigured' };
  const text = fs.read(configPath);
  if (text === undefined) return { state: 'unreadable', configPath };
  const flavour: ConfigFlavour = basename(configPath) === CONFIG_FILENAME ? 'm-cli' : 'pyproject';
  const rules = lintRulesOf(text, flavour);
  if (rules.kind === 'none') return { state: 'no-profile', configPath };
  return { state: 'configured', configPath, profile: rules.profile };
}
