/**
 * The wording of the profile surface (acceptance matrix A5).
 *
 * Pure by design — the vscode API stays in `src/ext/profile-status.ts`, so the
 * part that regresses (what it SAYS) is testable without an extension host,
 * the same split as `src/ext/status.ts` and `src/lsp/policy.ts`.
 *
 * The rule the wording serves: an unconfigured folder is not a neutral state.
 * `m` still lints it, under an unnamed default rule set that nobody chose and
 * that flatly does not fit VistA-era code — so the ungoverned states are
 * warning-tinted and say what is in effect meanwhile. Silence would be the
 * failure.
 */

import { basename } from 'node:path';
import { CONFIGURE_PROFILE_COMMAND, OPEN_PROFILE_CONFIG_COMMAND } from './contribution.js';
import { CONFIG_FILENAME } from './discovery.js';
import type { ProfileResolution } from './profile.js';

export type StatusSeverity = 'information' | 'warning';

export interface ProfileStatusView {
  /** Short line shown in the language-status surface. */
  text: string;
  /** Tooltip — names the governing file (or that there is none) in full. */
  detail: string;
  severity: StatusSeverity;
  /** Command id the surface offers. */
  command: string;
  /** Its button label. */
  commandTitle: string;
}

const UNGOVERNED_TEXT = 'no M profile configured — default rules in effect';

export function profileStatusView(resolution: ProfileResolution): ProfileStatusView {
  const open = { command: OPEN_PROFILE_CONFIG_COMMAND, commandTitle: 'Open config' };
  switch (resolution.state) {
    case 'configured':
      return {
        text: `profile: ${resolution.profile} — ${basename(resolution.configPath ?? '')}`,
        detail:
          `Lint profile \`${resolution.profile}\`, from ${resolution.configPath}. ` +
          'Editor diagnostics come from the same config `m lint` and CI read.',
        severity: 'information',
        ...open,
      };
    case 'no-profile':
      return {
        text: UNGOVERNED_TEXT,
        detail:
          `${resolution.configPath} governs this file but sets no \`[lint] rules\`, ` +
          'so `m` applies its unnamed default rule set. Add a `[lint] rules` key to choose ' +
          'a profile (`modern` for portable M, `vista` for VistA-era routines).',
        severity: 'warning',
        ...open,
      };
    case 'unreadable':
      return {
        text: `M profile: ${basename(resolution.configPath ?? '')} could not be read`,
        detail:
          `${resolution.configPath} exists but could not be read, so which profile governs ` +
          'this file is unknown. Open it and check permissions — do not assume the default.',
        severity: 'warning',
        ...open,
      };
    default:
      return {
        text: UNGOVERNED_TEXT,
        detail:
          `No \`${CONFIG_FILENAME}\` (or \`pyproject.toml\` \`[tool.m-cli]\`) governs this ` +
          'file, so `m` lints it with an unnamed default rule set that may not match this ' +
          'project — VistA-era code in particular needs the `vista` profile. Configure one ' +
          'to make the editor, `m lint` and CI agree.',
        severity: 'warning',
        command: CONFIGURE_PROFILE_COMMAND,
        commandTitle: 'Configure…',
      };
  }
}
