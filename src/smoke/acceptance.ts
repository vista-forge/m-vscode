/**
 * E3 acceptance suite — runs INSIDE a real VS Code (via `@vscode/test-electron`)
 * against the INSTALLED extension, one matrix scenario per cold launch
 * (`M_ACCEPT_SCENARIO` = A1…A5). The runner (`acceptance-run.ts`) prepares the
 * workspaces and aggregates the per-criterion evidence this suite records.
 *
 * Every criterion is asserted on PRODUCT output — real diagnostics, real
 * hovers, real semantic tokens, real format edits — never on internal state,
 * and each records a CriterionRow (pass/fail + measurement vs budget) so a
 * failure is a finding with evidence, not a bare assertion message.
 */

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { templateById } from '../config/templates.js';
import type { MVscodeApi } from '../ext/extension.js';
import {
  type AbsoluteToken,
  allPass,
  type CriterionRow,
  decodeSemanticTokens,
  percentile,
  renderTable,
} from './acceptance-model.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Ratified budgets (acceptance doc, operator 2026-07-20). Numbers, not vibes.
// (The live-lint p95 budget is gated in the RUNNER on the W0-c LSP-layer
// instrument; here the end-to-end counterpart is recorded as telemetry.)
const BUDGET_ON_SAVE_MS = 3500; // publish after save @ 1 MB
const BUDGET_IDLE_HOVER_MS = 500; // @ 1 MB, quiescent
const BUDGET_HOVER_DURING_LINT_MS = 500; // post-E1: tracks idle, not lint+idle
const BUDGET_OPEN_PUBLISH_SMALL_MS = 600; // didOpen→publish, <256 KiB (A1 class)
// ---------------------------------------------------------------------------

const rows: CriterionRow[] = [];
const info: Record<string, unknown> = {};

function record(
  scenario: string,
  criterion: string,
  pass: boolean,
  measured: string,
  budget: string,
): void {
  rows.push({ scenario, criterion, pass, measured, budget });
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
}

/** Arm a waiter BEFORE the triggering action; resolves with the event time. */
function armDiagnosticsEvent(uri: vscode.Uri, timeoutMs = 60_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`no diagnostics event for ${uri.fsPath} within ${timeoutMs} ms`));
    }, timeoutMs);
    const sub = vscode.languages.onDidChangeDiagnostics((e) => {
      if (e.uris.some((u) => u.toString() === uri.toString())) {
        clearTimeout(timer);
        sub.dispose();
        resolve(performance.now());
      }
    });
  });
}

interface CliFinding {
  line: number; // 1-based
  rule: string;
  file: string;
}

/** Run the REAL `m lint --output json` — the CLI side of the parity oracle. */
async function cliLint(cwd: string, target: string): Promise<CliFinding[]> {
  const { stdout } = await execFileAsync('m', ['lint', '--output', 'json', target], {
    cwd,
    maxBuffer: 256 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout) as {
    ok: boolean;
    diagnostics?: { file: string; line: number; rule: string }[];
    error?: { message?: string };
  };
  if (!parsed.ok) throw new Error(`m lint failed: ${parsed.error?.message ?? 'unknown'}`);
  return (parsed.diagnostics ?? []).map((d) => ({ line: d.line, rule: d.rule, file: d.file }));
}

function diagKeys(diags: readonly vscode.Diagnostic[]): string[] {
  return diags.map((d) => `${d.range.start.line + 1}:${String(d.code ?? '')}`).sort();
}

function cliKeys(findings: readonly CliFinding[]): string[] {
  return findings.map((f) => `${f.line}:${f.rule}`).sort();
}

async function hoverText(doc: vscode.TextDocument, pos: vscode.Position): Promise<string> {
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

function positionOf(
  doc: vscode.TextDocument,
  needle: string,
  offsetInNeedle: number,
): vscode.Position {
  const idx = doc.getText().indexOf(needle);
  if (idx < 0) throw new Error(`document does not contain ${JSON.stringify(needle)}`);
  return doc.positionAt(idx + offsetInNeedle);
}

async function openAndAwaitPublish(
  path: string,
): Promise<{ doc: vscode.TextDocument; ms: number | undefined }> {
  const uri = vscode.Uri.file(path);
  const armed = armDiagnosticsEvent(uri, 20_000);
  const t0 = performance.now();
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
  // A publish may legitimately never fire an event when the set stays empty
  // (nothing→nothing); treat that as "no measurement", not a failure.
  let ms: number | undefined;
  try {
    ms = (await armed) - t0;
  } catch {
    ms = undefined;
  }
  return { doc, ms };
}

/** The dual-table / alias / vendor-miss hover-truth block (A1 + A2). */
async function hoverTruth(scenario: string, fixturePath: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
  await vscode.window.showTextDocument(doc, { preview: false });

  const lg = await hoverText(doc, positionOf(doc, '$LG(', 1));
  record(
    scenario,
    'hover truth: $LG is the alias of $LISTGET, never $LENGTH',
    /\$LISTGET/.test(lg) && !/\$LENGTH/.test(lg) && /\$LG/.test(lg),
    lg.split('\n')[0]?.slice(0, 80) ?? '(empty)',
    'alias render names $LISTGET; $LENGTH absent',
  );

  const zbogus = await hoverText(doc, positionOf(doc, '$ZBOGUS(', 1));
  record(
    scenario,
    'hover truth: $ZBOGUS is a visible vendor-miss, not an invention',
    /vendor extension — not in the m-standard registry/.test(zbogus),
    zbogus.split('\n')[0]?.slice(0, 80) ?? '(empty)',
    'D-R2 honest miss render',
  );

  const ztriFn = await hoverText(doc, positionOf(doc, '$ZTRI(', 1));
  record(
    scenario,
    'hover truth: $ZTRI( in function context is $ZTRIGGER',
    /\$ZTRIGGER\b/.test(ztriFn) && !/\$ZTRIGGEROP/.test(ztriFn),
    ztriFn.split('\n')[0]?.slice(0, 80) ?? '(empty)',
    'function table selected by AST node kind',
  );

  const ztriSv = await hoverText(doc, positionOf(doc, 'write $ZTRI', 'write $'.length));
  record(
    scenario,
    'hover truth: bare $ZTRI in ISV context is $ZTRIGGEROP',
    /\$ZTRIGGEROP/.test(ztriSv),
    ztriSv.split('\n')[0]?.slice(0, 80) ?? '(empty)',
    'ISV table selected by AST node kind',
  );
}

function sortTokens(ts: AbsoluteToken[]): AbsoluteToken[] {
  return ts.sort(
    (a, b) =>
      a.line - b.line ||
      a.startColumn - b.startColumn ||
      a.typeIndex - b.typeIndex ||
      a.length - b.length,
  );
}

// ---------------------------------------------------------------------------
// A1 — m-modern-corpus (modern profile, configured project)
async function a1(): Promise<void> {
  const files = JSON.parse(env('M_ACCEPT_A1_FILES')) as string[];
  const oracle = JSON.parse(readFileSync(env('M_ACCEPT_A1_TOKENS'), 'utf8')) as Record<
    string,
    AbsoluteToken[]
  >;
  const corpusDir = env('M_ACCEPT_MODERN_DIR');

  const openTimes: number[] = [];
  for (const file of files) {
    const { doc, ms } = await openAndAwaitPublish(file);
    if (ms !== undefined) openTimes.push(ms);

    // Highlighting on open: the INSTALLED extension's semantic tokens must
    // match the independently computed source-tree oracle (ESM/source vs
    // CJS/installed — the two-programs seam, asserted on output).
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      doc.uri,
    );
    const got = sortTokens(decodeSemanticTokens([...(tokens?.data ?? [])]));
    const want = sortTokens(oracle[file] ?? []);
    const match = got.length > 0 && JSON.stringify(got) === JSON.stringify(want);
    record(
      'A1',
      `highlighting on open: ${file.split('/').pop()} tokens match the oracle`,
      match,
      `${got.length} tokens (oracle ${want.length})`,
      'non-empty AND byte-equal to the source-tree oracle capture',
    );

    // Diagnostics identical to `m lint` at quiescence.
    const cli = await cliLint(corpusDir, file);
    try {
      await waitFor(
        `diagnostics for ${file} to reach CLI parity`,
        () => vscode.languages.getDiagnostics(doc.uri).length === cli.length,
        15_000,
      );
    } catch {
      // fall through — the record below carries the mismatch.
    }
    const got2 = diagKeys(vscode.languages.getDiagnostics(doc.uri));
    const want2 = cliKeys(cli);
    record(
      'A1',
      `diagnostics == m lint at quiescence: ${file.split('/').pop()}`,
      JSON.stringify(got2) === JSON.stringify(want2),
      `editor ${got2.length} vs CLI ${want2.length} findings`,
      'same (line, rule) multiset as `m lint --output json`',
    );

    // Fmt byte-identical to the CLI (identity preset in this corpus): the
    // editor path must produce zero edits.
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      doc.uri,
      { tabSize: 8, insertSpaces: false },
    );
    record(
      'A1',
      `fmt byte-identical: ${file.split('/').pop()}`,
      (edits ?? []).length === 0,
      `${(edits ?? []).length} edits`,
      'zero edits (CLI fmt is identity on this corpus)',
    );
  }

  info.a1OpenPublishMs = openTimes;
  const p95 = openTimes.length > 0 ? percentile(openTimes, 95) : Number.NaN;
  record(
    'A1',
    'timings: didOpen→publish p95 across enumerated files (<256 KiB)',
    openTimes.length > 0 && p95 <= BUDGET_OPEN_PUBLISH_SMALL_MS,
    `p95 ${p95.toFixed(0)} ms over ${openTimes.length} measured opens`,
    `<= ${BUDGET_OPEN_PUBLISH_SMALL_MS} ms`,
  );

  await hoverTruth('A1', env('M_ACCEPT_HOVER_FIXTURE'));
}

// ---------------------------------------------------------------------------
// A2 — FileMan 22.2 (legibility-first, vista profile, identity-or-refuse fmt)
async function a2(api: MVscodeApi): Promise<void> {
  const routinesDir = env('M_ACCEPT_FILEMAN_DIR');
  const cleanFiles = JSON.parse(env('M_ACCEPT_A2_CLEAN')) as string[];
  const redFile = env('M_ACCEPT_A2_RED');

  // The committed vista profile governs — the E2 surface names it.
  const first = join(routinesDir, cleanFiles[0] ?? '');
  const { doc: firstDoc } = await openAndAwaitPublish(first);
  await waitFor(
    'the profile status item to resolve the FileMan routine',
    () => api.profileStatus().resolvedFor === dirname(first),
    30_000,
  );
  const status = api.profileStatus();
  record(
    'A2',
    'the committed vista profile governs and is named by the surface',
    /profile: vista — \.m-cli\.toml/.test(status.text) && status.severity === 'information',
    JSON.stringify({ text: status.text, severity: status.severity }),
    '"profile: vista — .m-cli.toml", information severity',
  );

  // Hover truth at maximum abbreviation density, on real FileMan code.
  const denseProbes: [string, number, RegExp, string][] = [
    ['$P(', 1, /\$PIECE/, '$P -> $PIECE'],
    ['$S(', 1, /\$SELECT/, '$S -> $SELECT'],
    ['$D(', 1, /\$DATA/, '$D -> $DATA'],
    ['$O(', 1, /\$ORDER/, '$O -> $ORDER'],
  ];
  for (const [needle, off, want, label] of denseProbes) {
    const md = await hoverText(firstDoc, positionOf(firstDoc, needle, off));
    record(
      'A2',
      `hover truth at density: ${label}`,
      want.test(md),
      md.split('\n')[0]?.slice(0, 80) ?? '(empty)',
      `${want}`,
    );
  }
  await hoverTruth('A2', env('M_ACCEPT_HOVER_FIXTURE'));

  // Lint meaningful under the vista profile: editor diagnostics equal the CLI
  // on every enumerated routine (0 findings on the clean ones — no spam).
  for (const name of cleanFiles) {
    const file = join(routinesDir, name);
    const { doc } = await openAndAwaitPublish(file);
    const cli = await cliLint(routinesDir, file);
    try {
      await waitFor(
        `diagnostics for ${name} to reach CLI parity`,
        () => vscode.languages.getDiagnostics(doc.uri).length === cli.length,
        15_000,
      );
    } catch {
      // recorded below
    }
    const got = diagKeys(vscode.languages.getDiagnostics(doc.uri));
    const want = cliKeys(cli);
    record(
      'A2',
      `lint under vista profile matches CLI (no spam): ${name}`,
      JSON.stringify(got) === JSON.stringify(want),
      `editor ${got.length} vs CLI ${want.length} findings`,
      'same (line, rule) multiset; clean DI* routines stay clean',
    );

    // Fmt identity from the editor path: zero edits on VA-distributed source.
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      doc.uri,
      { tabSize: 8, insertSpaces: false },
    );
    const before = readFileSync(file, 'utf8');
    record(
      'A2',
      `fmt identity from the editor: ${name}`,
      (edits ?? []).length === 0 && doc.getText() === before,
      `${(edits ?? []).length} edits; document ${doc.getText() === before ? 'unchanged' : 'CHANGED'}`,
      'zero edits, document byte-identical to disk',
    );
  }

  // The dispositioned red: loud, honest, refused — never rewritten.
  const redPath = join(routinesDir, redFile);
  const { doc: redDoc } = await openAndAwaitPublish(redPath);
  await waitFor(
    `parse errors for ${redFile} to surface`,
    () => vscode.languages.getDiagnostics(redDoc.uri).length > 0,
    15_000,
  );
  const redDiags = vscode.languages.getDiagnostics(redDoc.uri);
  // Loud = the parse errors are PRESENT at error severity; honest = the whole
  // set (including legitimate XINDX findings on the still-parseable lines)
  // equals the CLI's. "All diagnostics are parse errors" would be an invented
  // criterion — the vista profile legitimately reports on parseable lines.
  const redCli = await cliLint(routinesDir, redPath);
  const redParity = JSON.stringify(diagKeys(redDiags)) === JSON.stringify(cliKeys(redCli));
  record(
    'A2',
    `dispositioned baseline file is LOUD: ${redFile} shows M-INTERNAL-PARSE`,
    redDiags.some(
      (d) =>
        String(d.code) === 'M-INTERNAL-PARSE' && d.severity === vscode.DiagnosticSeverity.Error,
    ) && redParity,
    `${redDiags.length} diagnostics (CLI ${redCli.length}, parity ${redParity ? 'exact' : 'BROKEN'}), codes ${[...new Set(redDiags.map((d) => String(d.code)))].join(',')}`,
    'M-INTERNAL-PARSE present at error severity; full set == m lint (honest, loud)',
  );
  let redEdits: vscode.TextEdit[] | undefined;
  let redThrew = false;
  try {
    redEdits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      redDoc.uri,
      { tabSize: 8, insertSpaces: false },
    );
  } catch {
    redThrew = true;
  }
  const redBefore = readFileSync(redPath, 'utf8');
  record(
    'A2',
    `fmt REFUSES the parse-broken file: ${redFile}`,
    (redThrew || (redEdits ?? []).length === 0) && redDoc.getText() === redBefore,
    redThrew ? 'request rejected' : `${(redEdits ?? []).length} edits; document unchanged`,
    'no edit ever applied to a file the parser cannot own (T0-2 stays dead)',
  );
}

// ---------------------------------------------------------------------------
// A3 — the 1 MB torture routine (ratified budgets)
async function a3(): Promise<void> {
  const torturePath = env('M_ACCEPT_A3_TORTURE');
  const livePath = env('M_ACCEPT_A3_LIVE');
  // The runner tightens the client debounce via the workspace settings so the
  // didChange→publish measurement is the server's latency, not the client's
  // coalescing window; record what actually took effect (a silent fallback to
  // the 300 ms default would misattribute ~300 ms to the server).
  info.a3EffectiveDebounceMs = vscode.workspace
    .getConfiguration('mLanguageTools')
    .get('diagnostics.debounceMs');

  // End-to-end edit→squiggle-refresh on the <256 KiB document — RECORDED AS
  // TELEMETRY, not gated. The ratified 600 ms live-lint budget is a SERVER
  // budget (set on the W0-c didChange→publish instrument); this in-host
  // number additionally carries host-side costs the budget never included
  // (highlighter re-tokenization, diagnostic conversion, event dispatch —
  // measured ~350 ms on top of the server at this size). The GATED
  // measurement for that criterion is the runner's headless LspSession probe
  // against the same `m` binary; keeping this loop (a) produces the honest
  // end-to-end number and (b) exercises the full product path per edit.
  const { doc: liveDoc } = await openAndAwaitPublish(livePath);
  const liveLatencies: number[] = [];
  const editLatencies: number[] = [];
  const TOGGLE = '\tset badtab=1\n';
  for (let i = 0; i < 12; i++) {
    const text = liveDoc.getText();
    const edit = new vscode.WorkspaceEdit();
    const at = text.indexOf(TOGGLE);
    if (at < 0) {
      edit.insert(liveDoc.uri, liveDoc.positionAt(text.length), TOGGLE);
    } else {
      edit.delete(
        liveDoc.uri,
        new vscode.Range(liveDoc.positionAt(at), liveDoc.positionAt(at + TOGGLE.length)),
      );
    }
    const armed = armDiagnosticsEvent(liveDoc.uri, 20_000);
    const tEdit = performance.now();
    await vscode.workspace.applyEdit(edit);
    editLatencies.push(performance.now() - tEdit);
    const tPublished = await armed;
    liveLatencies.push(tPublished - tEdit);
  }
  info.a3LiveLatenciesMs = liveLatencies;
  info.a3EditApplyMs = editLatencies;
  info.a3EndToEndP95Ms = percentile(liveLatencies, 95);

  // The 1 MB document: open (on-save mode), then measure save→publish.
  const { doc: bigDoc, ms: bigOpenMs } = await openAndAwaitPublish(torturePath);
  info.a3TortureOpenPublishMs = bigOpenMs;
  const bigBytes = Buffer.byteLength(bigDoc.getText(), 'utf8');

  const saveOnce = async (): Promise<number> => {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(bigDoc.uri, new vscode.Position(0, 0), ';touch\n');
    await vscode.workspace.applyEdit(edit);
    const undo = new vscode.WorkspaceEdit();
    undo.delete(bigDoc.uri, new vscode.Range(0, 0, 1, 0));
    await vscode.workspace.applyEdit(undo);
    const armed = armDiagnosticsEvent(bigDoc.uri, 30_000);
    const t0 = performance.now();
    await bigDoc.save();
    return (await armed) - t0;
  };
  const saveMs = await saveOnce();
  record(
    'A3',
    `on-save publish @ ${(bigBytes / 1024 / 1024).toFixed(2)} MB`,
    saveMs <= BUDGET_ON_SAVE_MS,
    `${saveMs.toFixed(0)} ms`,
    `<= ${BUDGET_ON_SAVE_MS} ms`,
  );

  // Idle hover at 1 MB, quiescent.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const needle = ['$O(', '$P(', '$G(', '$D(', '$o(', '$p(', '$g(', '$d('].find(
    (n) => bigDoc.getText().indexOf(n) >= 0,
  );
  if (!needle) throw new Error('torture document contains no hoverable intrinsic');
  const hoverPos = positionOf(bigDoc, needle, 1);
  const tIdle = performance.now();
  const idleHover = await hoverText(bigDoc, hoverPos);
  const idleMs = performance.now() - tIdle;
  record(
    'A3',
    'idle hover @ 1 MB',
    idleMs <= BUDGET_IDLE_HOVER_MS && idleHover.length > 0,
    `${idleMs.toFixed(0)} ms (${idleHover.split('\n')[0]?.slice(0, 40) ?? ''})`,
    `<= ${BUDGET_IDLE_HOVER_MS} ms, non-empty`,
  );

  // Hover DURING the in-flight 1 MB lint — the E1 acceptance metric.
  const edit = new vscode.WorkspaceEdit();
  edit.insert(bigDoc.uri, new vscode.Position(0, 0), ';touch2\n');
  await vscode.workspace.applyEdit(edit);
  const undo = new vscode.WorkspaceEdit();
  undo.delete(bigDoc.uri, new vscode.Range(0, 0, 1, 0));
  await vscode.workspace.applyEdit(undo);
  const armed = armDiagnosticsEvent(bigDoc.uri, 30_000);
  const tSave = performance.now();
  void bigDoc.save();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const tKey = performance.now();
  const keyEdit = new vscode.WorkspaceEdit();
  keyEdit.insert(bigDoc.uri, new vscode.Position(0, 0), ';k\n');
  await vscode.workspace.applyEdit(keyEdit);
  const keyMs = performance.now() - tKey;
  const keyUndo = new vscode.WorkspaceEdit();
  keyUndo.delete(bigDoc.uri, new vscode.Range(0, 0, 1, 0));
  await vscode.workspace.applyEdit(keyUndo);
  const tDuring = performance.now();
  const duringHover = await hoverText(bigDoc, hoverPos);
  const duringMs = performance.now() - tDuring;
  const publishAt = await armed;
  const overlapProven = publishAt > tDuring + duringMs;
  info.a3DuringLint = { duringMs, publishLatencyMs: publishAt - tSave, overlapProven };
  record(
    'A3',
    'hover during in-flight 1 MB lint (post-E1: tracks idle)',
    duringMs <= BUDGET_HOVER_DURING_LINT_MS && duringHover.length > 0,
    `${duringMs.toFixed(0)} ms (lint publish ${(publishAt - tSave).toFixed(0)} ms later; overlap ${overlapProven ? 'proven' : 'NOT proven'})`,
    `<= ${BUDGET_HOVER_DURING_LINT_MS} ms`,
  );
  record(
    'A3',
    'keystroke responsiveness during in-flight lint',
    keyMs <= 500,
    `applyEdit ${keyMs.toFixed(0)} ms`,
    '<= 500 ms (UI thread never blocked by the lint)',
  );
}

// ---------------------------------------------------------------------------
// A4 — the garbage file: loud, honest, end-to-end
async function a4(): Promise<void> {
  const garbagePath = env('M_ACCEPT_A4_FILE');
  const { doc } = await openAndAwaitPublish(garbagePath);
  await waitFor(
    'parse errors for the garbage file to surface in the Problems panel',
    () => vscode.languages.getDiagnostics(doc.uri).length > 0,
    20_000,
  );
  const diags = vscode.languages.getDiagnostics(doc.uri);
  record(
    'A4',
    'garbage file: Problems panel shows the parse error, no silent green',
    diags.length > 0 &&
      diags.every(
        (d) =>
          String(d.code) === 'M-INTERNAL-PARSE' && d.severity === vscode.DiagnosticSeverity.Error,
      ),
    `${diags.length} diagnostics: ${diags[0] ? `${String(diags[0].code)} "${diags[0].message.slice(0, 40)}"` : '(none)'}`,
    'non-empty M-INTERNAL-PARSE errors (the T0-1 class stays dead)',
  );
}

// ---------------------------------------------------------------------------
// A5 — the unconfigured folder: the E2-UX surface, worded as shipped
async function a5(api: MVscodeApi): Promise<void> {
  const filePath = env('M_ACCEPT_A5_FILE');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, { preview: false });
  await waitFor(
    'the profile status item to resolve the unconfigured document',
    () => api.profileStatus().resolvedFor === dirname(filePath),
  );
  const unconfigured = api.profileStatus();
  record(
    'A5',
    'unconfigured folder SAYS so, worded as shipped',
    /^no M profile configured — default rules in effect$/.test(unconfigured.text) &&
      unconfigured.severity === 'warning' &&
      unconfigured.command === 'mVscode.configureProfile',
    JSON.stringify(unconfigured.text),
    '"no M profile configured — default rules in effect", warning, one-click remedy',
  );

  const baseline = vscode.languages.getDiagnostics(doc.uri).length;
  await vscode.commands.executeCommand('mVscode.configureProfile', 'vista');
  const written = readFileSync(join(dirname(filePath), '.m-cli.toml'), 'utf8');
  const templateOk = written === templateById('vista')?.content;
  try {
    await waitFor(
      'diagnostics to change under the newly written vista profile',
      () =>
        vscode.languages.getDiagnostics(doc.uri).some((d) => /violates the SAC/.test(d.message)),
      60_000,
    );
  } catch {
    // recorded below
  }
  const after = vscode.languages.getDiagnostics(doc.uri);
  record(
    'A5',
    'the one-click remedy writes the template and changes REAL diagnostics',
    templateOk && after.some((d) => /violates the SAC/.test(d.message)),
    `template ${templateOk ? 'verbatim' : 'WRONG'}; diagnostics ${baseline} -> ${after.length}`,
    'vista template verbatim; SAC findings appear only after the profile flip',
  );
  await waitFor('the status item to name the vista profile', () =>
    /profile: vista/.test(api.profileStatus().text),
  );
  record(
    'A5',
    'the surface follows the remedy',
    /profile: vista/.test(api.profileStatus().text) &&
      api.profileStatus().severity === 'information',
    api.profileStatus().text,
    '"profile: vista — .m-cli.toml", no longer a warning',
  );
}

// ---------------------------------------------------------------------------

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set — the acceptance runner prepares this`);
  return v;
}

export async function run(): Promise<void> {
  const scenario = env('M_ACCEPT_SCENARIO');
  const evidencePath = env('M_ACCEPT_EVIDENCE');

  const extension = vscode.extensions.getExtension('vista-forge.m-vscode');
  if (!extension) throw new Error('vista-forge.m-vscode is not present in the host');
  const api = (await extension.activate()) as MVscodeApi;
  if (!api.highlight().grammarLoaded) {
    throw new Error('the tree-sitter-m grammar did not load in the installed extension');
  }

  try {
    switch (scenario) {
      case 'A1':
        await a1();
        break;
      case 'A2':
        await a2(api);
        break;
      case 'A3':
        await a3();
        break;
      case 'A4':
        await a4();
        break;
      case 'A5':
        await a5(api);
        break;
      default:
        throw new Error(`unknown scenario ${scenario}`);
    }
  } finally {
    writeFileSync(evidencePath, JSON.stringify({ scenario, rows, info }, null, 2));
    process.stdout.write(`\n${renderTable(rows)}\n`);
  }

  if (!allPass(rows)) {
    throw new Error(
      `${scenario}: ${rows.filter((r) => !r.pass).length} of ${rows.length} criteria FAILED (see table above)`,
    );
  }
  process.stdout.write(`${scenario}: all ${rows.length} criteria PASS\n`);
}
