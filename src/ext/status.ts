import { isMumpsFile, MUMPS_LANGUAGE_ID } from '../lang/contribution.js';

export interface StatusInput {
  /** The extension version, read from the manifest at activation. */
  version: string;
  /** Path of the active editor's document, if any. */
  activeFile: string | undefined;
}

/**
 * Build the one-line status string shown by the `mVscode.showStatus` command.
 *
 * Pure by design: the vscode API surface stays in `extension.ts`, so the wording
 * (the part that regresses) is testable without an extension host.
 */
export function statusMessage(input: StatusInput): string {
  const head = `M Language Tools ${input.version} — active.`;
  if (input.activeFile === undefined) return `${head} No file open.`;
  const base = input.activeFile.split(/[/\\]/).pop() ?? input.activeFile;
  const tail = isMumpsFile(input.activeFile)
    ? `${base}: M language (${MUMPS_LANGUAGE_ID}).`
    : `${base}: not an M file.`;
  return `${head} ${tail}`;
}
