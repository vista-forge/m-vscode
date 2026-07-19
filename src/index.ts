/**
 * Public surface of m-vscode's non-extension-host logic.
 *
 * The VS Code entry point is `src/ext/extension.ts` (bundled to
 * `dist/extension.cjs`); this module exports only the pieces that are useful
 * — and testable — outside an extension host.
 */

export { type StatusInput, statusMessage } from './ext/status.js';
export {
  isMumpsFile,
  MUMPS_ALIASES,
  MUMPS_EXTENSIONS,
  MUMPS_LANGUAGE_ID,
} from './lang/contribution.js';
