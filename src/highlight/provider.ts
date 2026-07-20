import { join } from 'node:path';
import * as vscode from 'vscode';
import { MHighlighter, type TypingSession } from './highlighter.js';
import { LEGEND } from './mapping.js';
import { GrammarArtifactError } from './wasm.js';

/**
 * The VS Code adapter over `MHighlighter`. Thin by construction: it owns
 * per-document sessions and the legend index mapping, and nothing else. All the
 * behaviour worth testing lives in the vscode-free modules beside it.
 *
 * Incremental parsing is wired through `onDidChangeTextDocument` so a keystroke
 * costs an incremental re-parse rather than a full one; VS Code then asks for
 * tokens and gets the already-updated tree. R1's fixture drives exactly this
 * path (minus the vscode types), which is why it is worth having.
 */

const LANGUAGE_ID = 'mumps';

export const SEMANTIC_TOKENS_LEGEND = new vscode.SemanticTokensLegend(
  [...LEGEND.types],
  [...LEGEND.modifiers],
);

const typeIndex = new Map(LEGEND.types.map((t, i) => [t, i]));
const modifierBit = new Map(LEGEND.modifiers.map((m, i) => [m, 1 << i]));

export async function registerHighlighting(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  let highlighter: MHighlighter;
  try {
    // Assets are staged into `dist/assets` by `scripts/bundle-assets.mjs` so the
    // packaged layout and the dev layout resolve identically.
    const base = join(context.extensionPath, 'dist');
    highlighter = await MHighlighter.create(base, { runtimeDir: join(base, 'assets') });
  } catch (err) {
    // NEVER fail quiet. An extension that silently declines to colour anything
    // is indistinguishable from a theme that chose not to — so say it out loud,
    // in the one place a user looks, with the fix in the text.
    const message =
      err instanceof GrammarArtifactError
        ? err.message
        : `M syntax highlighting failed to start: ${(err as Error).message}`;
    output.appendLine(`[highlight] ${message}`);
    void vscode.window.showErrorMessage(message);
    return;
  }

  output.appendLine(
    `[highlight] tree-sitter-m grammar ${highlighter.grammarVersion} ` +
      `(${highlighter.artifactSha256.slice(0, 12)}…) loaded; ` +
      `${LEGEND.types.length} token types.`,
  );
  context.subscriptions.push({ dispose: () => highlighter.dispose() });

  const sessions = new Map<string, TypingSession>();
  const sessionFor = (doc: vscode.TextDocument): TypingSession => {
    const key = doc.uri.toString();
    let session = sessions.get(key);
    if (!session) {
      session = highlighter.open(doc.getText());
      sessions.set(key, session);
    }
    return session;
  };
  const drop = (doc: vscode.TextDocument): void => {
    const key = doc.uri.toString();
    sessions.get(key)?.dispose();
    sessions.delete(key);
  };

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(drop),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== LANGUAGE_ID) return;
      const session = sessions.get(e.document.uri.toString());
      if (!session) return;
      for (const change of e.contentChanges) {
        session.replace(change.rangeOffset, change.rangeOffset + change.rangeLength, change.text);
      }
      // Cheap paranoia: if VS Code and the session ever disagree about the text,
      // the tree is authoritative for nothing. Rebuild rather than mis-colour.
      if (session.text !== e.document.getText()) drop(e.document);
    }),
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: LANGUAGE_ID },
      {
        provideDocumentSemanticTokens(doc) {
          const builder = new vscode.SemanticTokensBuilder(SEMANTIC_TOKENS_LEGEND);
          for (const token of sessionFor(doc).tokens()) {
            const type = typeIndex.get(token.type);
            if (type === undefined) continue;
            let mods = 0;
            for (const m of token.modifiers) mods |= modifierBit.get(m) ?? 0;
            builder.push(token.line, token.startColumn, token.length, type, mods);
          }
          return builder.build();
        },
      },
      SEMANTIC_TOKENS_LEGEND,
    ),
  );
}
