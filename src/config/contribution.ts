/**
 * Source of truth for the profile-UX manifest surface (E2 / matrix A5).
 *
 * `package.json`'s `contributes.commands` is a projection of these constants;
 * `manifest.test.ts` red-gates the drift. Same pattern as
 * `src/engine/contribution.ts` and `src/lang/contribution.ts`.
 */

/** Writes a `.m-cli.toml` from a template, after asking which one. */
export const CONFIGURE_PROFILE_COMMAND = 'mVscode.configureProfile';
/** Opens the config file that already governs the active document. */
export const OPEN_PROFILE_CONFIG_COMMAND = 'mVscode.openProfileConfig';

export const PROFILE_COMMANDS = [CONFIGURE_PROFILE_COMMAND, OPEN_PROFILE_CONFIG_COMMAND] as const;

export type ProfileCommand = (typeof PROFILE_COMMANDS)[number];
