/**
 * In-host smoke suite (run by `@vscode/test-electron` inside a REAL VS
 * Code) — the strongest evidence available that hover/completion/
 * documentSymbol/foldingRange actually reach the UI, not just the wire.
 *
 * Everything up to this point (`equivalence.e2e.test.ts`,
 * `capabilities.e2e.test.ts`) proves the protocol: `m lsp` answers, and its
 * answers are well-formed. Neither proves `vscode-languageclient` actually
 * turns those answers into registered VS Code providers a user's cursor can
 * reach — that step lives entirely inside `client.ts`, which imports
 * `vscode` and cannot run under `node:test`. This file closes that gap by
 * driving the SAME commands VS Code's own UI drives
 * (`vscode.executeHoverProvider` et al.) against the real, bundled
 * extension, activated the same way a user's editor activates it.
 *
 * Not part of `make check` — it needs a display and an installed VS Code
 * (see `src/smoke/run.ts`), same carve-out as vista-compass's smoke suite.
 * Run with `npm run test:vscode`; report the result manually, as the P4
 * dual-engine acceptance run already does for engine features.
 */

import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

function positionOf(
  doc: vscode.TextDocument,
  needle: string,
  offsetInNeedle: number,
): vscode.Position {
  const idx = doc.getText().indexOf(needle);
  assert.ok(idx >= 0, `fixture contains ${JSON.stringify(needle)}`);
  return doc.positionAt(idx + offsetInNeedle);
}

async function hoverMarkdown(doc: vscode.TextDocument, pos: vscode.Position): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    doc.uri,
    pos,
  );
  return (hovers ?? [])
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n');
}

export async function run(): Promise<void> {
  const file = process.env.M_VSCODE_SMOKE_FILE;
  assert.ok(file, 'M_VSCODE_SMOKE_FILE set');

  // Capture error toasts from here on, BEFORE the failure-visibility check
  // below fires one deliberately (§5).
  const errors: string[] = [];
  const originalShowError = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as { showErrorMessage: unknown }).showErrorMessage = (
    message: string,
    ...rest: unknown[]
  ) => {
    errors.push(message);
    return (originalShowError as (m: string, ...r: unknown[]) => Thenable<unknown>)(
      message,
      ...rest,
    );
  };

  // Capture every line the extension writes to its "M Language Tools" output
  // channel — that is where `client.ts` announces sync-mode decisions, the
  // launch command line, and any server stderr, none of which is otherwise
  // visible from outside the extension host. Printed only on failure, below.
  const outputLines: string[] = [];
  const originalCreateOutputChannel = vscode.window.createOutputChannel.bind(vscode.window);
  (vscode.window as { createOutputChannel: unknown }).createOutputChannel = (
    ...args: unknown[]
  ) => {
    const channel = (originalCreateOutputChannel as (...a: unknown[]) => vscode.OutputChannel)(
      ...(args as [string]),
    );
    const originalAppendLine = channel.appendLine.bind(channel);
    channel.appendLine = (line: string) => {
      outputLines.push(line);
      return originalAppendLine(line);
    };
    const originalAppend = channel.append.bind(channel);
    channel.append = (line: string) => {
      outputLines.push(line);
      return originalAppend(line);
    };
    return channel;
  };

  const extension = vscode.extensions.getExtension('vista-forge.m-vscode');
  assert.ok(extension, 'vista-forge.m-vscode present in the host');

  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  // extension.activate() resolves only once our activate() function's promise
  // chain resolves, which includes `await client.start()` — so by the time
  // this returns, initialize/initialized has already completed and the
  // server's capabilities have been negotiated.
  try {
    await extension.activate();
  } catch (err) {
    process.stdout.write(
      `SMOKE FAIL during activate(): ${(err as Error).stack ?? String(err)}\n` +
        `M Language Tools output channel:\n${outputLines.map((l) => `  | ${l}`).join('\n')}\n`,
    );
    throw err;
  }

  // Regression guard for the reentrancy hazard `serialize.ts` closes: the
  // client must start EXACTLY once during activation, never twice from a
  // config-change event racing the activation restart.
  const starts = outputLines.filter((l) => l.includes('started `m lsp`'));
  assert.equal(
    starts.length,
    1,
    `expected the client to start exactly once, saw ${starts.length}: ${JSON.stringify(outputLines)}`,
  );

  // 1. Hover: real markdown, with the per-engine provenance sentence — the
  // differentiating feature (proposal §2/§4-D) rendered where a user's
  // cursor actually sees it.
  const hoverPos = positionOf(doc, '$ZATRANSFORM', 1);
  const hoverMd = await hoverMarkdown(doc, hoverPos);
  assert.match(hoverMd, /\$ZATRANSFORM/, `hover names the symbol, got: ${hoverMd}`);
  assert.match(
    hoverMd,
    /In YottaDB.*not in the ANSI standard or IRIS/,
    `hover renders per-engine provenance, got: ${hoverMd}`,
  );
  assert.match(hoverMd, /Standard status: `ydb-extension`/, 'hover renders standard-status line');

  // 2. Completion: a real, non-empty list through `vscode.executeCompletionItemProvider`.
  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    hoverPos,
  );
  assert.ok(completions, 'completion list resolved');
  assert.ok((completions.items ?? []).length > 0, 'completion list is non-empty');

  // 3. documentSymbol: the routine and its labels, through the same command
  // VS Code's Outline view calls.
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    doc.uri,
  );
  assert.ok(
    (symbols ?? []).some((s) => s.name === 'ZZCAP'),
    `outline includes the routine, got: ${(symbols ?? []).map((s) => s.name).join(', ')}`,
  );

  // 4. foldingRange: at least one fold, through the same command the gutter uses.
  const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
    'vscode.executeFoldingRangeProvider',
    doc.uri,
  );
  assert.ok((folds ?? []).length > 0, 'folding ranges non-empty');

  // 5. Failure-visibility regression: a broken server path must produce a
  // VISIBLE, ACTIONABLE error — never a silently dead extension. Point
  // `mLanguageTools.serverPath` at a binary that cannot exist, let the
  // extension's own `onDidChangeConfiguration` handler restart the client,
  // and assert the real `vscode.window.showErrorMessage` fired with the
  // message `missingServerMessage` produces.
  const cfg = vscode.workspace.getConfiguration('mLanguageTools');
  await cfg.update(
    'serverPath',
    '/does/not/exist/m-vscode-smoke-nonexistent',
    vscode.ConfigurationTarget.Global,
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.ok(
    errors.some((e) => /could not start the language server/.test(e)),
    `expected a visible, actionable error for a missing server binary, saw: ${JSON.stringify(errors)}`,
  );
  await cfg.update('serverPath', undefined, vscode.ConfigurationTarget.Global);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  process.stdout.write(
    'SMOKE PASS: hover (with per-engine provenance), completion, documentSymbol, foldingRange ' +
      'all reach vscode.execute*Provider; a broken server path fails visibly via showErrorMessage\n',
  );
}
