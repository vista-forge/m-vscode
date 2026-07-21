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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { templateById } from '../config/templates.js';
import type { MVscodeApi } from '../ext/extension.js';

/**
 * Poll until `predicate` holds, or fail naming what never happened. The
 * profile surface and the diagnostics that follow a config write are both
 * asynchronous (a watcher event, a language-server restart, a re-lint), so a
 * fixed sleep would be either flaky or slow.
 */
async function waitFor(what: string, predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`timed out after ${timeoutMs} ms waiting for ${what}`);
}

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

  // 5. Highlighting: the tree-sitter AST semantic-token provider must actually
  // START and PRODUCE TOKENS in a real host. This is the assertion whose
  // absence let P1-downstream ship broken — every unit test ran the highlighter
  // under `node --import tsx` (ESM), while the product runs the esbuild CJS
  // bundle, where web-tree-sitter's emscripten runtime resolved its own
  // location differently. "The extension activated" is NOT evidence a feature
  // works; only the feature's own output is.
  const highlightLines = outputLines.filter((l) => l.startsWith('[highlight]'));
  assert.ok(
    highlightLines.some((l) => /tree-sitter-m grammar .* loaded/.test(l)),
    `expected the M grammar to load in the host, [highlight] output was: ${JSON.stringify(highlightLines)}`,
  );
  const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
    'vscode.provideDocumentSemanticTokensLegend',
    doc.uri,
  );
  assert.ok(
    (legend?.tokenTypes ?? []).length > 0,
    'a semantic-tokens legend is registered for the document',
  );
  const semanticTokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
    'vscode.provideDocumentSemanticTokens',
    doc.uri,
  );
  assert.ok(
    (semanticTokens?.data.length ?? 0) > 0,
    `expected non-empty AST semantic tokens for ${file}, got ${semanticTokens?.data.length ?? 'none'}`,
  );
  assert.equal(
    semanticTokens.data.length % 5,
    0,
    'semantic token data is the 5-uint-per-token encoding',
  );

  // 6. Profile UX (E2 / acceptance matrix A5): an unconfigured folder must SAY
  // so, and the one-click remedy must actually change what the user sees.
  // Asserted on the real `LanguageStatusItem` the extension publishes (read
  // back through its API export) and on real diagnostics — never on an
  // internal model, because the failure this closes is a surface that silently
  // reports the wrong profile.
  const api = (await extension.activate()) as MVscodeApi;
  const unconfiguredFile = process.env.M_VSCODE_SMOKE_UNCONFIGURED_FILE;
  assert.ok(unconfiguredFile, 'M_VSCODE_SMOKE_UNCONFIGURED_FILE set');

  // (a) unconfigured scratch workspace — the honest warning state.
  const scratchDoc = await vscode.workspace.openTextDocument(unconfiguredFile);
  await vscode.window.showTextDocument(scratchDoc);
  await waitFor(
    'the profile status item to resolve the scratch document',
    () => api.profileStatus().resolvedFor === dirname(unconfiguredFile),
  );
  const unconfigured = api.profileStatus();
  assert.match(
    unconfigured.text,
    /no M profile configured — default rules in effect/,
    `unconfigured folder must say so, got: ${JSON.stringify(unconfigured)}`,
  );
  assert.equal(unconfigured.severity, 'warning', 'the unconfigured state is warning-tinted');
  assert.equal(
    unconfigured.command,
    'mVscode.configureProfile',
    'the unconfigured state offers the one-click remedy',
  );

  // (b) the one-click remedy writes the vista template, and the diagnostics
  // the user sees change with it. ZZCAP.m yields ZERO findings under the
  // unnamed default rule set and TWO SAC findings under `vista` — so the
  // diagnostic set itself proves the profile took effect, not just the label.
  assert.equal(
    vscode.languages.getDiagnostics(scratchDoc.uri).length,
    0,
    'baseline: the default rule set finds nothing in this fixture',
  );
  await vscode.commands.executeCommand('mVscode.configureProfile', 'vista');
  const written = readFileSync(join(dirname(unconfiguredFile), '.m-cli.toml'), 'utf8');
  assert.equal(written, templateById('vista')?.content, 'the vista template is written verbatim');
  await waitFor('the status item to name the vista profile', () =>
    /profile: vista/.test(api.profileStatus().text),
  );
  assert.equal(api.profileStatus().severity, 'information', 'a governed folder is not a warning');
  await waitFor(
    'diagnostics to refresh under the newly written vista profile',
    () =>
      vscode.languages
        .getDiagnostics(scratchDoc.uri)
        .some((d) => /violates the SAC/.test(d.message)),
    60_000,
  );

  // (c) an already-configured project shows its governing config.
  const configuredDoc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(configuredDoc);
  await waitFor(
    'the status item to follow the active editor',
    () => api.profileStatus().resolvedFor === dirname(file),
  );
  const configured = api.profileStatus();
  assert.match(
    configured.text,
    /profile: default — \.m-cli\.toml/,
    `configured project names its profile, got: ${JSON.stringify(configured)}`,
  );
  assert.match(
    configured.detail,
    /src\/lsp\/fixtures\/capabilities\/\.m-cli\.toml/,
    `configured project names the governing file, got: ${configured.detail}`,
  );

  // 7. Failure-visibility regression: a broken server path must produce a
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
      'all reach vscode.execute*Provider; AST highlighting loads the grammar and emits ' +
      `${semanticTokens.data.length / 5} semantic tokens; ` +
      'an unconfigured folder SAYS so and the one-click remedy changes real diagnostics; ' +
      'a broken server path fails visibly via showErrorMessage\n',
  );
}
